"""
VehicleGPT — Storage Layer
Two-tier: RAM ring buffer (hot) + SQLite time-series (cold)
"""
import sqlite3
import time
import json
import threading
import logging
from collections import deque
from pathlib import Path
from typing import List, Optional

logger = logging.getLogger("vehiclegpt.storage")


# ══════════════════════════════════════════════════════════════
#  TIER 1 — RAM Ring Buffer (last N signals, instant access)
# ══════════════════════════════════════════════════════════════
class RingBuffer:
    """Thread-safe fixed-size ring buffer for hot signal data."""

    def __init__(self, maxsize: int = 3000):
        self._buf = deque(maxlen=maxsize)
        self._lock = threading.Lock()

    def push(self, signal) -> None:
        with self._lock:
            self._buf.append(signal)

    def get_all(self) -> list:
        with self._lock:
            return list(self._buf)

    def get_latest(self, signal_id: str, n: int = 1) -> list:
        """Return last N readings for a specific signal."""
        with self._lock:
            results = [s for s in self._buf if s.signal_id == signal_id]
        return results[-n:]

    def get_active_warnings(self) -> list:
        """Return all signals currently at WARNING or above."""
        with self._lock:
            return [s for s in self._buf if s.severity in ("WARNING", "FAULT", "CRITICAL")]

    def snapshot(self) -> dict:
        """Return one latest reading per unique signal_id (dashboard snapshot)."""
        with self._lock:
            seen = {}
            for s in reversed(self._buf):
                if s.signal_id not in seen:
                    seen[s.signal_id] = s
        return seen


# ══════════════════════════════════════════════════════════════
#  TIER 2 — SQLite Time-Series (4-week rolling cold storage)
# ══════════════════════════════════════════════════════════════
class TimeSeriesDB:
    """
    SQLite with WAL mode for write-heavy embedded workloads.
    Auto-purges data older than retention_days (default 28).
    """

    SCHEMA = """
    CREATE TABLE IF NOT EXISTS signals (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        ts_us       INTEGER NOT NULL,
        signal_id   TEXT    NOT NULL,
        value       REAL,
        str_value   TEXT,
        unit        TEXT    DEFAULT '',
        severity    TEXT    DEFAULT 'INFO',
        source      TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ts          ON signals(ts_us);
    CREATE INDEX IF NOT EXISTS idx_signal_ts   ON signals(signal_id, ts_us);
    CREATE INDEX IF NOT EXISTS idx_severity_ts ON signals(severity, ts_us);
    CREATE INDEX IF NOT EXISTS idx_source_ts   ON signals(source, ts_us);
    """

    PURGE_TRIGGER = """
    CREATE TRIGGER IF NOT EXISTS purge_old AFTER INSERT ON signals
    BEGIN
        DELETE FROM signals
        WHERE ts_us < (NEW.ts_us - (? * 86400 * 1000000));
    END;
    """

    def __init__(self, db_path: str, retention_days: int = 28):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._path = db_path
        self._retention_days = retention_days
        self._lock = threading.Lock()
        self._batch: list = []
        self._batch_size = 100
        self._conn = self._connect()
        self._init_schema()
        logger.info(f"TimeSeriesDB ready at {db_path} (retention={retention_days}d)")

    # ── Connection ──────────────────────────────────────────
    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._path, check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA cache_size=-8000")    # 8 MB page cache
        conn.execute("PRAGMA temp_store=MEMORY")
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self):
        with self._conn:
            self._conn.executescript(self.SCHEMA)
            # Cannot bind params in trigger DDL — embed directly
            trigger = f"""
            CREATE TRIGGER IF NOT EXISTS purge_old AFTER INSERT ON signals
            BEGIN
                DELETE FROM signals
                WHERE ts_us < (NEW.ts_us - ({self._retention_days} * 86400 * 1000000));
            END;
            """
            self._conn.executescript(trigger)

    # ── Write ───────────────────────────────────────────────
    def insert(self, signal) -> None:
        """Insert a NormalizedSignal into the DB (batched for performance)."""
        row = (
            signal.timestamp_us,
            signal.signal_id,
            signal.value,
            signal.str_value,
            signal.unit,
            signal.severity,
            signal.source,
        )
        with self._lock:
            self._batch.append(row)
            if len(self._batch) >= self._batch_size:
                self._flush()

    def flush(self) -> None:
        """Force flush any pending batch."""
        with self._lock:
            self._flush()

    def _flush(self):
        if not self._batch:
            return
        try:
            with self._conn:
                self._conn.executemany(
                    "INSERT INTO signals (ts_us,signal_id,value,str_value,unit,severity,source) "
                    "VALUES (?,?,?,?,?,?,?)",
                    self._batch,
                )
            self._batch.clear()
        except Exception as e:
            logger.error(f"DB flush error: {e}")

    # ── Query ───────────────────────────────────────────────
    def query_signal(
        self,
        signal_id: str,
        start_us: Optional[int] = None,
        end_us: Optional[int] = None,
        limit: int = 1000,
    ) -> List[dict]:
        now_us = int(time.time() * 1e6)
        start_us = start_us or (now_us - 3600 * 1e6)  # default: last hour
        end_us = end_us or now_us

        rows = self._conn.execute(
            "SELECT * FROM signals WHERE signal_id=? AND ts_us BETWEEN ? AND ? "
            "ORDER BY ts_us DESC LIMIT ?",
            (signal_id.upper(), int(start_us), int(end_us), limit),
        ).fetchall()
        return [dict(r) for r in rows]

    def query_severity(
        self,
        severity: str,
        hours: int = 24,
        limit: int = 200,
    ) -> List[dict]:
        now_us = int(time.time() * 1e6)
        start_us = now_us - hours * 3600 * 1_000_000
        rows = self._conn.execute(
            "SELECT * FROM signals WHERE severity=? AND ts_us >= ? "
            "ORDER BY ts_us DESC LIMIT ?",
            (severity.upper(), start_us, limit),
        ).fetchall()
        return [dict(r) for r in rows]

    def query_recent(self, hours: int = 1, limit: int = 500) -> List[dict]:
        now_us = int(time.time() * 1e6)
        start_us = now_us - hours * 3600 * 1_000_000
        rows = self._conn.execute(
            "SELECT * FROM signals WHERE ts_us >= ? ORDER BY ts_us DESC LIMIT ?",
            (start_us, limit),
        ).fetchall()
        return [dict(r) for r in rows]

    def query_faults(self, days: int = 7) -> List[dict]:
        return self.query_severity("FAULT", hours=days * 24) + \
               self.query_severity("CRITICAL", hours=days * 24)

    def query_historical_vitals(self, days: int = 7) -> dict:
        """Calculate aggregated statistical vitals from rolling historical storage."""
        def _agg(signal_id):
            row = self._conn.execute(
                "SELECT MIN(value), MAX(value), AVG(value), COUNT(*) FROM signals WHERE signal_id=?",
                (signal_id.upper(),)
            ).fetchone()
            if row and row[3] > 0:
                return {"min": round(row[0] or 0.0, 1), "max": round(row[1] or 0.0, 1), "avg": round(row[2] or 0.0, 1), "count": row[3]}
            return {"min": 0.0, "max": 0.0, "avg": 0.0, "count": 0}

        faults = self.query_faults(days=days)
        total_row = self._conn.execute("SELECT COUNT(*) FROM signals").fetchone()
        total_records = total_row[0] if total_row else 0
        return {
            "speed": _agg("PERF_VEHICLE_SPEED"),
            "rpm": _agg("ENGINE_RPM"),
            "coolant": _agg("ENGINE_COOLANT_TEMP"),
            "battery": _agg("BATTERY_VOLTAGE"),
            "fuel": _agg("FUEL_LEVEL"),
            "tyres": _agg("TIRE_PRESSURE_FL"),
            "oil": _agg("OIL_PRESSURE"),
            "fault_count": len(faults),
            "recent_faults": [f.get("signal_id") for f in faults[:5]],
            "total_records": total_records,
        }

    def close(self):
        self.flush()
        self._conn.close()
        logger.info("TimeSeriesDB closed.")
