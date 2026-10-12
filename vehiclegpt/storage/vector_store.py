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

        self._load_or_create()
        self._load_embedder()

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
            logger.error("sentence-transformers not installed. Run: pip install sentence-transformers")

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

    # ── Add Events ───────────────────────────────────────────
    def add_signal(self, signal) -> None:
        """Add a NormalizedSignal to the vector store (events only)."""
        # Only embed notable events — not every routine sensor tick
        if signal.severity == "INFO":
            return

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
