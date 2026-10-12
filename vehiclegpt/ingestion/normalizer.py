"""
VehicleGPT — Signal Normalizer
Converts raw signals from any source into a unified envelope dict.
All ingestion modules push through here before hitting storage.
"""
import time
import json
import logging
from dataclasses import dataclass, asdict
from typing import Optional, Any

logger = logging.getLogger("vehiclegpt.normalizer")

# Severity thresholds — extend per vehicle config
SEVERITY_MAP = {
    "ENGINE_COOLANT_TEMP":  {"WARNING": 90.0, "FAULT": 105.0, "CRITICAL": 120.0},
    "BATTERY_VOLTAGE":      {"WARNING": 11.8, "FAULT": 11.0,  "CRITICAL": 10.5},
    "OIL_PRESSURE":         {"WARNING": 15.0, "FAULT": 10.0,  "CRITICAL": 5.0},
    "FUEL_LEVEL":           {"WARNING": 15.0, "FAULT": 5.0,   "CRITICAL": 2.0},
    "EV_BATTERY_LEVEL":     {"WARNING": 20.0, "FAULT": 10.0,  "CRITICAL": 5.0},
    "BRAKE_TEMP_FL":        {"WARNING": 300.0,"FAULT": 400.0, "CRITICAL": 500.0},
    "TIRE_PRESSURE_FL":     {"WARNING": 28.0, "FAULT": 25.0,  "CRITICAL": 20.0},
}

ADAS_EVENT_SIGNALS = {"FCW_STATUS", "LDW_STATUS", "BSW_STATUS", "AEB_STATUS", "CAMERA_FAULT"}


@dataclass
class NormalizedSignal:
    timestamp_us: int       # microsecond epoch
    source: str             # CAN | CAN_FD | SOMEIP | HAL | QNX | ADAS | REPLAY
    signal_id: str          # Canonical signal name
    value: Optional[float]  # Numeric value or None
    str_value: Optional[str]# String value (for enums/states)
    unit: str               # celsius, rpm, kPa, %,  etc.
    severity: str           # INFO | WARNING | FAULT | CRITICAL

    def to_dict(self) -> dict:
        return asdict(self)

    def to_text_chunk(self) -> str:
        """Convert to human-readable text for embedding into vector store."""
        ts = self.timestamp_us / 1e6
        from datetime import datetime, timezone
        dt = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
        val = self.str_value if self.str_value else f"{self.value} {self.unit}"
        return (
            f"[{dt}] SOURCE={self.source} SIGNAL={self.signal_id} "
            f"VALUE={val} SEVERITY={self.severity}"
        )


class SignalNormalizer:
    def __init__(self):
        self._stats = {"total": 0, "warnings": 0, "faults": 0}

    def normalize(
        self,
        signal_id: str,
        value: Any,
        source: str,
        unit: str = "",
        timestamp_us: Optional[int] = None,
    ) -> NormalizedSignal:
        """Normalize a raw signal into unified format."""
        ts = timestamp_us if timestamp_us else int(time.time() * 1e6)
        signal_id = signal_id.upper().strip()

        # Resolve numeric value
        num_val: Optional[float] = None
        str_val: Optional[str] = None

        if isinstance(value, (int, float)):
            num_val = float(value)
        elif isinstance(value, str):
            try:
                num_val = float(value)
            except ValueError:
                str_val = value

        # Determine severity
        severity = self._compute_severity(signal_id, num_val, str_val)

        self._stats["total"] += 1
        if severity == "WARNING":
            self._stats["warnings"] += 1
        elif severity in ("FAULT", "CRITICAL"):
            self._stats["faults"] += 1

        sig = NormalizedSignal(
            timestamp_us=ts,
            source=source,
            signal_id=signal_id,
            value=num_val,
            str_value=str_val,
            unit=unit,
            severity=severity,
        )

        if severity != "INFO":
            logger.warning(
                f"[{severity}] {signal_id}={num_val or str_val} {unit} from {source}"
            )

        return sig

    def _compute_severity(
        self,
        signal_id: str,
        num_val: Optional[float],
        str_val: Optional[str],
    ) -> str:
        """Determine severity level from thresholds or string state."""
        # ADAS events are always at least WARNING
        if signal_id in ADAS_EVENT_SIGNALS:
            if str_val and str_val.upper() in ("ACTIVE", "TRIGGERED", "1", "TRUE"):
                return "WARNING"
            return "INFO"

        # DTC fault codes are always FAULT
        if signal_id.startswith("DTC_") or signal_id.startswith("P0"):
            return "FAULT"

        # QNX / System errors
        if str_val and str_val.upper() in ("ERROR", "FAULT", "CRITICAL", "FAIL"):
            return "CRITICAL"

        if num_val is None:
            return "INFO"

        thresholds = SEVERITY_MAP.get(signal_id)
        if not thresholds:
            return "INFO"

        # For pressure/fuel/battery: lower is worse
        if signal_id in ("OIL_PRESSURE", "FUEL_LEVEL", "EV_BATTERY_LEVEL",
                          "BATTERY_VOLTAGE", "TIRE_PRESSURE_FL",
                          "TIRE_PRESSURE_FR", "TIRE_PRESSURE_RL", "TIRE_PRESSURE_RR"):
            if num_val <= thresholds["CRITICAL"]:
                return "CRITICAL"
            elif num_val <= thresholds["FAULT"]:
                return "FAULT"
            elif num_val <= thresholds["WARNING"]:
                return "WARNING"
            return "INFO"

        # For temperature / default: higher is worse
        if num_val >= thresholds.get("CRITICAL", float("inf")):
            return "CRITICAL"
        elif num_val >= thresholds.get("FAULT", float("inf")):
            return "FAULT"
        elif num_val >= thresholds.get("WARNING", float("inf")):
            return "WARNING"
        return "INFO"

    def get_stats(self) -> dict:
        return self._stats.copy()
