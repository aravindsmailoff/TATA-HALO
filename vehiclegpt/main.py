"""
VehicleGPT — Main Entry Point
Orchestrates all subsystems: ingestion, storage, RAG, API, and HMI.
"""
import sys
import os
import time
import signal
import logging
import threading
import yaml
from queue import Queue
from pathlib import Path

# Ensure UTF-8 output on Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Ensure vehiclegpt directory is on sys.path
BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

# ── Bootstrap Logging ────────────────────────────────────────
def setup_logging(cfg: dict):
    raw_dir = cfg.get("log_dir", "./logs")
    log_dir = Path(raw_dir)
    if not log_dir.is_absolute():
        log_dir = BASE_DIR / log_dir
    log_dir.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=getattr(logging, cfg.get("log_level", "INFO").upper(), logging.INFO),
        format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(log_dir / "vehiclegpt.log", encoding="utf-8"),
        ],
    )

logger = logging.getLogger("vehiclegpt.main")


# ── Load Config ──────────────────────────────────────────────
def load_config(path: str = None) -> dict:
    if path is None:
        cfg_path = BASE_DIR / "config" / "config.yaml"
    else:
        cfg_path = Path(path)
        if not cfg_path.is_absolute():
            cfg_path = BASE_DIR / cfg_path
    with open(cfg_path, encoding="utf-8") as f:
        return yaml.safe_load(f)


# ── Signal Consumer Thread ───────────────────────────────────
def signal_consumer(queue: Queue, ring_buffer, timeseries_db, vector_store, stop_event):
    """
    Drains the shared ingestion queue and distributes signals to:
      - Ring buffer (hot, RAM)
      - SQLite DB (cold, disk)
      - Vector store (events only, semantic search)
    """
    flush_interval = 30.0  # flush SQLite batch every 30s
    last_flush = time.time()
    vs_rebuild_interval = 300.0
    last_vs_save = time.time()

    while not stop_event.is_set():
        try:
            sig = queue.get(timeout=1.0)
        except Exception:
            sig = None

        if sig:
            ring_buffer.push(sig)
            timeseries_db.insert(sig)
            vector_store.add_signal(sig)

        now = time.time()
        if now - last_flush > flush_interval:
            timeseries_db.flush()
            last_flush = now

        if now - last_vs_save > vs_rebuild_interval:
            vector_store.save()
            last_vs_save = now


# ── Main ─────────────────────────────────────────────────────
def main():
    print("\n" + "=" * 60)
    print("  VehicleGPT -- On-Device Vehicle Intelligence")
    print("  Starting up...")
    print("=" * 60 + "\n")

    # Load config
    cfg = load_config()
    setup_logging(cfg.get("system", {}))

    # ── Init Storage ─────────────────────────────────────────
    from storage.timeseries_db import TimeSeriesDB, RingBuffer
    from storage.vector_store import VectorStore

    storage_cfg = cfg.get("storage", {})
    ring_buffer = RingBuffer(maxsize=storage_cfg.get("ring_buffer_size", 3000))
    
    raw_sqlite = storage_cfg.get("sqlite_path", "./data/db/signals.db")
    sqlite_path = Path(raw_sqlite)
    if not sqlite_path.is_absolute():
        sqlite_path = BASE_DIR / sqlite_path

    timeseries_db = TimeSeriesDB(
        db_path=str(sqlite_path),
        retention_days=storage_cfg.get("retention_days", 28),
    )

    rag_cfg = cfg.get("rag", {}).copy()
    for k in ("faiss_index_path", "faiss_metadata_path"):
        if k in rag_cfg:
            p = Path(rag_cfg[k])
            if not p.is_absolute():
                rag_cfg[k] = str(BASE_DIR / p)
    vector_store = VectorStore(rag_cfg)

    # ── Init Ingestion ───────────────────────────────────────
    from ingestion.normalizer import SignalNormalizer
    normalizer = SignalNormalizer()
    ingestion_queue: Queue = Queue(maxsize=10000)

    # ── Init Simulation / Replay ─────────────────────────────
    from simulation.replay_logs import LogReplayer, FaultInjector

    fault_injector = FaultInjector(ingestion_queue, normalizer)
    ingest_cfg = cfg.get("ingestion", {})

    if ingest_cfg.get("replay", {}).get("enabled", False):
        replay_file = ingest_cfg["replay"].get("replay_file", "")
        p_replay = Path(replay_file)
        if not p_replay.is_absolute():
            p_replay = BASE_DIR / p_replay
        speed = ingest_cfg["replay"].get("speed_multiplier", 1.0)
        if p_replay.exists():
            replayer = LogReplayer(str(p_replay), ingestion_queue, normalizer, speed)
            replayer.start()
        else:
            logger.warning(f"Replay file not found: {p_replay}")
            logger.info("Generating sample drive data...")
            from simulation.replay_logs import generate_sample_csv
            sample_path = generate_sample_csv(output_path=str(BASE_DIR / "data" / "datasets" / "raw" / "sample_drive.csv"))
            replayer = LogReplayer(sample_path, ingestion_queue, normalizer, 5.0)
            replayer.start()

    # ── Start CAN Gateway ────────────────────────────────────
    can_cfg = ingest_cfg.get("can", {}).copy()
    if can_cfg.get("enabled", False):
        if "dbc_files" in can_cfg:
            can_cfg["dbc_files"] = [
                str(BASE_DIR / f) if not Path(f).is_absolute() else f
                for f in can_cfg["dbc_files"]
            ]
        from ingestion.can_gateway import CANGateway
        can_gw = CANGateway(can_cfg, ingestion_queue, normalizer)
        can_gw.start()

    # ── Start Signal Consumer Thread ─────────────────────────
    stop_event = threading.Event()
    consumer_thread = threading.Thread(
        target=signal_consumer,
        args=(ingestion_queue, ring_buffer, timeseries_db, vector_store, stop_event),
        daemon=True,
        name="SignalConsumer",
    )
    consumer_thread.start()
    logger.info("Signal consumer started.")

    # ── Init LLM ─────────────────────────────────────────────
    from inference.llm_engine import LLMEngine
    inf_cfg = cfg.get("inference", {}).copy()
    for k in ("grammar_file", "gguf_path"):
        if k in inf_cfg and inf_cfg[k]:
            p = Path(inf_cfg[k])
            if not p.is_absolute():
                inf_cfg[k] = str(BASE_DIR / p)
    llm = LLMEngine(inf_cfg)

    if not llm.health_check():
        logger.warning(
            "\n[!] Ollama model not ready or offline. System will operate in fast edge rule/sensor mode.\n"
            "    To use local LLM: ollama create vehiclegpt -f ./inference/modelfile/Modelfile\n"
        )

    # ── Init RAG Pipeline ────────────────────────────────────
    from rag.pipeline import RAGPipeline
    rag = RAGPipeline(ring_buffer, timeseries_db, vector_store, llm, rag_cfg)

    # ── Init REST API ─────────────────────────────────────────
    import uvicorn
    from api.rest_api import app, init_api
    init_api(rag, ring_buffer, timeseries_db, vector_store, fault_injector, normalizer)

    api_cfg = cfg.get("api", {})
    host = api_cfg.get("host", "127.0.0.1")
    port = api_cfg.get("port", 8765)

    logger.info(f"\n{'='*60}")
    logger.info(f"  VehicleGPT API ready at http://localhost:{port}")
    logger.info(f"  Health: http://localhost:{port}/health")
    logger.info(f"  Docs:   http://localhost:{port}/docs")
    logger.info(f"{'='*60}\n")

    # ── Graceful Shutdown ─────────────────────────────────────
    def shutdown(sig=None, frame=None):
        logger.info("Shutting down VehicleGPT...")
        stop_event.set()
        timeseries_db.flush()
        vector_store.save()
        timeseries_db.close()
        logger.info("VehicleGPT shut down cleanly.")
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    # ── Mount HMI static files ────────────────────────────────
    from fastapi.staticfiles import StaticFiles
    hmi_path = BASE_DIR / "hmi"
    if hmi_path.exists():
        app.mount("/hmi", StaticFiles(directory=str(hmi_path), html=True), name="hmi")

    uvicorn.run(app, host=host, port=port, log_level="warning")


if __name__ == "__main__":
    main()
