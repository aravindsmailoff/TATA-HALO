"""
VehicleGPT — FAISS Vector Store
Embeds NormalizedSignal events as text, stores in FAISS for semantic search.
Enables natural language historical queries like:
  "When did the engine overheat last week?"
"""
import json
import time
import logging
import threading
import numpy as np
from pathlib import Path
from typing import List, Tuple, Optional

logger = logging.getLogger("vehiclegpt.vector_store")


class VectorStore:
    """
    FAISS-based semantic vector store for vehicle event chunks.
    Uses sentence-transformers (all-MiniLM-L6-v2 INT8) for embedding.
    Memory footprint: ~22 MB model + ~30 MB index (4 weeks, events only).
    """

    def __init__(self, cfg: dict):
        self.index_path = Path(cfg["faiss_index_path"])
        self.meta_path = Path(cfg["faiss_metadata_path"])
        self.top_k = cfg.get("top_k_results", 5)
        self.dim = cfg.get("embedding_dim", 384)

        self._lock = threading.Lock()
        self._metadata: List[dict] = []   # parallel list to FAISS index
        self._index = None
        self._embedder = None
        self._pending: List[Tuple[np.ndarray, dict]] = []
        self._last_added: dict = {}

        self._load_or_create()
        self._load_embedder()
        self.index_repair_manual()

    # ── Init ─────────────────────────────────────────────────
    def _load_embedder(self):
        try:
            from sentence_transformers import SentenceTransformer
            self._embedder = SentenceTransformer(
                "all-MiniLM-L6-v2",
                device="cpu",
            )
            logger.info("Embedding model loaded (all-MiniLM-L6-v2)")
        except ImportError:
            logger.warning("sentence-transformers not installed. Semantic vector search disabled.")
            self._embedder = None
        except Exception as e:
            logger.warning(f"Could not load embedding model ({e}). Semantic vector search disabled.")
            self._embedder = None

    def _load_or_create(self):
        try:
            import faiss
        except ImportError:
            logger.error("faiss not installed. Run: pip install faiss-cpu")
            return

        import faiss
        self.index_path.parent.mkdir(parents=True, exist_ok=True)

        if self.index_path.exists() and self.meta_path.exists():
            try:
                self._index = faiss.read_index(str(self.index_path))
                with open(self.meta_path, "r") as f:
                    self._metadata = json.load(f)
                logger.info(f"FAISS index loaded: {self._index.ntotal} vectors")
                return
            except Exception as e:
                logger.warning(f"FAISS index load failed ({e}), creating new.")

        self._index = faiss.IndexFlatL2(self.dim)
        self._metadata = []
        logger.info("New FAISS index created.")

    def index_repair_manual(self, manual_path: Optional[str] = None) -> None:
        """Index the Tata repair manuals for semantic retrieval."""
        if not self._embedder:
            return

        manual_files = [
            self.index_path.parent.parent / "datasets" / "raw" / "tata_punch_repair_manual.json",
            self.index_path.parent.parent / "datasets" / "raw" / "comprehensive_repair_manual.json",
        ]
        if manual_path:
            manual_files = [Path(manual_path)]

        for p in manual_files:
            if not p.exists():
                continue
            try:
                with open(p, "r", encoding="utf-8") as f:
                    manual = json.load(f)

                indexed_topics = {m.get("topic") for m in self._metadata if "topic" in m}
                added = 0
                for item in manual:
                    topic = item.get("topic", "")
                    if topic in indexed_topics:
                        continue
                    if "step_by_step" in item:
                        steps_text = " ".join(item.get("step_by_step", []))
                        text = f"{topic}: {item.get('simple_explanation', '')} Steps: {steps_text}"
                    else:
                        text = f"{topic} ({item.get('category', 'REPAIR')}): {item.get('guide', '')}"

                    self.add_text(text, meta={
                        "text": text,
                        "topic": topic,
                        "source": "REPAIR_MANUAL",
                        "keywords": item.get("keywords", [])
                    })
                    added += 1

                if added > 0:
                    self.save()
                    logger.info(f"Indexed {added} entries from {p.name} into FAISS vector store.")
            except Exception as e:
                logger.warning(f"Could not index repair manual {p.name}: {e}")

    # ── Add Events ───────────────────────────────────────────
    def add_signal(self, signal) -> None:
        """Add a NormalizedSignal to the vector store (events only)."""
        # Only embed notable events — not every routine sensor tick
        if signal.severity == "INFO":
            return

        now = time.time()
        if signal.signal_id in self._last_added:
            if now - self._last_added[signal.signal_id] < 60.0:
                return
        self._last_added[signal.signal_id] = now

        text = signal.to_text_chunk()
        self._add_text(text, meta={
            "text": text,
            "signal_id": signal.signal_id,
            "severity": signal.severity,
            "source": signal.source,
            "timestamp_us": signal.timestamp_us,
        })

    def add_text(self, text: str, meta: Optional[dict] = None) -> None:
        """Add arbitrary text chunk (e.g., QNX log line, diagnostic summary)."""
        self._add_text(text, meta=meta or {"text": text})

    def _add_text(self, text: str, meta: dict) -> None:
        if self._embedder is None or self._index is None:
            return
        try:
            vec = self._embedder.encode([text], convert_to_numpy=True, normalize_embeddings=True)
            with self._lock:
                self._index.add(vec.astype(np.float32))
                self._metadata.append(meta)
        except Exception as e:
            logger.error(f"Embedding error: {e}")

    # ── Search ───────────────────────────────────────────────
    def search(self, query: str, k: Optional[int] = None) -> List[dict]:
        """Return top-K most semantically similar stored events."""
        if self._embedder is None or self._index is None:
            return []
        if self._index.ntotal == 0:
            return []

        k = min(k or self.top_k, self._index.ntotal)

        try:
            vec = self._embedder.encode([query], convert_to_numpy=True, normalize_embeddings=True)
            distances, indices = self._index.search(vec.astype(np.float32), k)

            results = []
            with self._lock:
                for i, dist in zip(indices[0], distances[0]):
                    if 0 <= i < len(self._metadata):
                        entry = self._metadata[i].copy()
                        entry["_score"] = float(1.0 / (1.0 + dist))  # similarity score
                        results.append(entry)
            return results
        except Exception as e:
            logger.error(f"FAISS search error: {e}")
            return []

    # ── Persistence ──────────────────────────────────────────
    def save(self) -> None:
        """Persist FAISS index and metadata to disk."""
        if self._index is None:
            return
        try:
            import faiss
            with self._lock:
                faiss.write_index(self._index, str(self.index_path))
                with open(self.meta_path, "w") as f:
                    json.dump(self._metadata, f)
            logger.info(f"FAISS saved: {self._index.ntotal} vectors")
        except Exception as e:
            logger.error(f"FAISS save error: {e}")

    def get_stats(self) -> dict:
        return {
            "total_vectors": self._index.ntotal if self._index else 0,
            "index_path": str(self.index_path),
        }
