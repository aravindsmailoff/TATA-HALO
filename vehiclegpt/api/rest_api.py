"""
VehicleGPT — REST API
FastAPI server exposing the VehicleGPT pipeline over HTTP.
Runs on localhost:8765 — no external network access required.

Endpoints:
  POST /query          — Natural language query
  GET  /status         — Current vehicle status snapshot
  GET  /faults         — Active fault codes
  GET  /history        — Historical signal search
  GET  /health         — System health check
  POST /inject-fault   — Inject simulated fault (dev/test only)
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

logger = logging.getLogger("vehiclegpt.api")

app = FastAPI(
    title="VehicleGPT API",
    description="On-device natural language vehicle intelligence",
    version="1.0.0",
    docs_url="/docs",
)

# CORS for HMI access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global references — set by main.py at startup
_rag = None
_ring = None
_db = None
_vector_store = None
_fault_injector = None
_normalizer = None


def init_api(rag, ring_buffer, timeseries_db, vector_store, fault_injector, normalizer):
    """Called by main.py to inject dependencies."""
    global _rag, _ring, _db, _vector_store, _fault_injector, _normalizer
    _rag = rag
    _ring = ring_buffer
    _db = timeseries_db
    _vector_store = vector_store
    _fault_injector = fault_injector
    _normalizer = normalizer


# ── Request / Response Models ────────────────────────────────
class QueryRequest(BaseModel):
    query: str
    context: Optional[str] = None   # Optional extra context from client


class FaultInjectRequest(BaseModel):
    scenario: str


class ManualSignalRequest(BaseModel):
    """
    ════════════════════════════════════════════════════════
    📂  MANUAL DATASET FEED ENDPOINT
    POST /feed-signal to manually inject a signal or test
    event into the running system for dataset generation.
    ════════════════════════════════════════════════════════
    """
    signal_id: str
    value: float | str
    unit: str = ""
    source: str = "MANUAL"


# ── Endpoints ────────────────────────────────────────────────
@app.post("/query")
async def query(req: QueryRequest):
    """Natural language query — main VehicleGPT interface."""
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty.")
    if _rag is None:
        raise HTTPException(status_code=503, detail="VehicleGPT pipeline not initialized.")

    result = _rag.query(req.query)
    return result


@app.get("/predict")
async def predict_forecast():
    """Predictive vehicle health, fuel depletion, and service forecast from drive telemetry."""
    if _rag is None or _ring is None:
        raise HTTPException(status_code=503, detail="Pipeline not initialized.")
    snapshot = _ring.snapshot()
    f_val = snapshot.get("FUEL_LEVEL").value if snapshot.get("FUEL_LEVEL") else 62.0
    s_val = snapshot.get("PERF_VEHICLE_SPEED").value if snapshot.get("PERF_VEHICLE_SPEED") else 55.0
    c_val = snapshot.get("ENGINE_COOLANT_TEMP").value if snapshot.get("ENGINE_COOLANT_TEMP") else 89.5
    v_val = snapshot.get("BATTERY_VOLTAGE").value if snapshot.get("BATTERY_VOLTAGE") else 13.8
    o_val = snapshot.get("OIL_PRESSURE").value if snapshot.get("OIL_PRESSURE") else 41.5

    return {
        "status": "OK",
        "forecast_summary": _rag.predictor.predict_overall(snapshot),
        "fuel": _rag.predictor.predict_fuel(f_val, s_val),
        "coolant": _rag.predictor.predict_coolant(c_val),
        "battery": _rag.predictor.predict_battery(v_val),
        "oil_service": _rag.predictor.predict_oil_and_service(o_val),
    }


@app.get("/status")
async def status():
    """Current vehicle snapshot — all latest signal readings."""
    if _ring is None:
        raise HTTPException(status_code=503, detail="Storage not initialized.")

    snapshot = _ring.snapshot()
    warnings = _ring.get_active_warnings()

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "signal_count": len(snapshot),
        "active_warnings": len(warnings),
        "signals": {
            sig_id: {
                "value": s.value,
                "str_value": s.str_value,
                "unit": s.unit,
                "severity": s.severity,
                "source": s.source,
            }
            for sig_id, s in snapshot.items()
        },
        "warnings": [
            {
                "signal_id": w.signal_id,
                "value": w.value or w.str_value,
                "severity": w.severity,
            }
            for w in warnings
        ],
    }


@app.get("/faults")
async def faults(days: int = 7):
    """List fault and critical events from the last N days."""
    if _db is None:
        raise HTTPException(status_code=503, detail="DB not initialized.")

    results = _db.query_faults(days=days)
    return {
        "period_days": days,
        "total": len(results),
        "faults": results,
    }


@app.get("/history")
async def history(q: str, k: int = 5):
    """Semantic search over historical events."""
    if _vector_store is None:
        raise HTTPException(status_code=503, detail="Vector store not initialized.")

    results = _vector_store.search(q, k=k)
    return {
        "query": q,
        "results": results,
    }


@app.post("/inject-fault")
async def inject_fault(req: FaultInjectRequest, background_tasks: BackgroundTasks):
    """Inject a simulated fault scenario (DEV/TEST USE ONLY)."""
    if _fault_injector is None:
        raise HTTPException(status_code=503, detail="Fault injector not initialized.")

    scenarios = _fault_injector.list_scenarios()
    if req.scenario not in scenarios:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown scenario '{req.scenario}'. Available: {scenarios}",
        )

    background_tasks.add_task(_fault_injector.inject_scenario, req.scenario)
    return {"message": f"Scenario '{req.scenario}' injecting in background.", "available": scenarios}


@app.post("/feed-signal")
async def feed_signal(req: ManualSignalRequest):
    """
    ════════════════════════════════════════════════════════════
    📂  MANUAL DATASET FEED ENDPOINT
    Inject a custom signal into the live pipeline.
    Use this to:
      - Feed real sensor readings when CAN hardware is absent
      - Simulate specific vehicle states for testing
      - Generate labeled training data by observing responses
    ════════════════════════════════════════════════════════════
    """
    if _normalizer is None or _ring is None:
        raise HTTPException(status_code=503, detail="Pipeline not initialized.")

    sig = _normalizer.normalize(
        signal_id=req.signal_id,
        value=req.value,
        source=req.source,
        unit=req.unit,
    )
    _ring.push(sig)
    if _db:
        _db.insert(sig)
    if _vector_store and sig.severity != "INFO":
        _vector_store.add_signal(sig)

    return {
        "message": "Signal injected successfully.",
        "signal": sig.to_dict(),
    }


@app.get("/health")
async def health():
    """System health check."""
    from pathlib import Path
    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "pipeline_ready": _rag is not None,
        "db_ready": _db is not None,
        "vector_store_ready": _vector_store is not None,
        "ring_buffer_size": len(_ring.get_all()) if _ring else 0,
        "db_stats": _db.get_stats() if _db else {},
        "vector_stats": _vector_store.get_stats() if _vector_store else {},
    }


@app.get("/scenarios")
async def list_scenarios():
    """List available fault injection scenarios."""
    if _fault_injector is None:
        return {"scenarios": []}
    return {"scenarios": _fault_injector.list_scenarios()}
