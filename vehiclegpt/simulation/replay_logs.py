"""
VehicleGPT — Simulation Log Replayer (No CARLA)
Replays recorded vehicle data from CSV/JSON files to simulate real CAN input.
Use this to test, validate, and generate training data without real hardware.

Supported formats:
  - CSV:  timestamp_us, signal_id, value, unit, source
  - JSON: list of NormalizedSignal dicts
  - MF4:  (requires asammdf) industry-standard measurement files

Usage:
  python simulation/replay_logs.py --file data/datasets/raw/sample_drive.csv --speed 5.0
"""
import time
import json
import csv
import logging
import argparse
import threading
from pathlib import Path
from queue import Queue

logger = logging.getLogger("vehiclegpt.replay")


class LogReplayer:
    """
    Replays recorded signal log files at configurable speed.
    Drops signals into the same output queue as the real CAN gateway.
    """

    def __init__(self, replay_file: str, output_queue: Queue, normalizer,
                 speed: float = 1.0):
        self.file = Path(replay_file)
        self.q = output_queue
        self.norm = normalizer
        self.speed = max(speed, 0.1)
        self._running = False
        self._thread = None

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._run, daemon=True, name="LogReplayer")
        self._thread.start()
        logger.info(f"Replaying {self.file.name} at {self.speed}x speed")

    def stop(self):
        self._running = False
        logger.info("Log replay stopped.")

    def _run(self):
        ext = self.file.suffix.lower()
        if ext == ".csv":
            self._replay_csv()
        elif ext == ".json":
            self._replay_json()
        elif ext in (".mf4", ".mf"):
            self._replay_mf4()
        else:
            logger.error(f"Unsupported replay format: {ext}")

    # ── CSV Replay ───────────────────────────────────────────
    def _replay_csv(self):
        """
        CSV format:
        timestamp_us,signal_id,value,unit,source
        1728751200000000,ENGINE_COOLANT_TEMP,92.4,celsius,CAN
        """
        rows = []
        with open(self.file, newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                rows.append(row)

        if not rows:
            logger.warning("Empty CSV file.")
            return

        prev_ts = int(rows[0].get("timestamp_us", 0))

        for row in rows:
            if not self._running:
                break

            ts = int(row.get("timestamp_us", 0))
            delay = (ts - prev_ts) / 1e6 / self.speed
            if delay > 0:
                time.sleep(min(delay, 1.0))   # cap sleep at 1s for safety
            prev_ts = ts

            sig = self.norm.normalize(
                signal_id=row.get("signal_id", "UNKNOWN"),
                value=row.get("value", 0),
                source=row.get("source", "REPLAY"),
                unit=row.get("unit", ""),
                timestamp_us=ts,
            )
            try:
                self.q.put_nowait(sig)
            except Exception:
                pass

        logger.info("CSV replay complete.")

    # ── JSON Replay ──────────────────────────────────────────
    def _replay_json(self):
        """JSON: list of signal dicts with same keys as NormalizedSignal."""
        with open(self.file) as f:
            records = json.load(f)

        prev_ts = records[0].get("timestamp_us", 0) if records else 0

        for rec in records:
            if not self._running:
                break

            ts = rec.get("timestamp_us", int(time.time() * 1e6))
            delay = (ts - prev_ts) / 1e6 / self.speed
            if delay > 0:
                time.sleep(min(delay, 1.0))
            prev_ts = ts

            sig = self.norm.normalize(
                signal_id=rec.get("signal_id", "UNKNOWN"),
                value=rec.get("value") or rec.get("str_value", ""),
                source=rec.get("source", "REPLAY"),
                unit=rec.get("unit", ""),
                timestamp_us=ts,
            )
            try:
                self.q.put_nowait(sig)
            except Exception:
                pass

        logger.info("JSON replay complete.")

    # ── MF4 Replay ───────────────────────────────────────────
    def _replay_mf4(self):
        """MF4 (Vector/ETAS format) — requires: pip install asammdf"""
        try:
            import asammdf
        except ImportError:
            logger.error("asammdf not installed. Run: pip install asammdf")
            return

        mf = asammdf.MDF(str(self.file))
        df = mf.to_dataframe()

        prev_ts = df.index[0] if len(df) > 0 else 0
        for ts, row in df.iterrows():
            if not self._running:
                break

            delay = (float(ts) - float(prev_ts)) / self.speed
            if delay > 0:
                time.sleep(min(delay, 1.0))
            prev_ts = ts

            for col in df.columns:
                sig = self.norm.normalize(
                    signal_id=col,
                    value=row[col],
                    source="MF4_REPLAY",
                    unit="",
                    timestamp_us=int(float(ts) * 1e6),
                )
                try:
                    self.q.put_nowait(sig)
                except Exception:
                    pass

        logger.info("MF4 replay complete.")


# ── Fault Injector ───────────────────────────────────────────
class FaultInjector:
    """
    Synthetically inject fault conditions for testing the AI pipeline.
    Call inject_scenario() with a named scenario to trigger event sequences.
    """

    SCENARIOS = {
        "engine_overheat": [
            ("ENGINE_COOLANT_TEMP", 88, "celsius"),
            ("ENGINE_COOLANT_TEMP", 93, "celsius"),
            ("ENGINE_COOLANT_TEMP", 108, "celsius"),
            ("ENGINE_COOLANT_TEMP", 122, "celsius"),
        ],
        "low_fuel": [
            ("FUEL_LEVEL", 18, "%"),
            ("FUEL_LEVEL", 12, "%"),
            ("FUEL_LEVEL", 5, "%"),
        ],
        "battery_drain": [
            ("BATTERY_VOLTAGE", 12.2, "V"),
            ("BATTERY_VOLTAGE", 11.7, "V"),
            ("BATTERY_VOLTAGE", 11.1, "V"),
        ],
        "aeb_activation": [
            ("FCW_STATUS", "ACTIVE", ""),
            ("AEB_STATUS", "TRIGGERED", ""),
            ("FCW_STATUS", "INACTIVE", ""),
            ("AEB_STATUS", "INACTIVE", ""),
        ],
        "tire_pressure_drop": [
            ("TIRE_PRESSURE_FL", 32, "kPa"),
            ("TIRE_PRESSURE_FL", 27, "kPa"),
            ("TIRE_PRESSURE_FL", 22, "kPa"),
        ],
        "dtc_fault": [
            ("DTC_P0217", "ACTIVE", ""),
            ("DTC_P0217", "STORED", ""),
        ],
    }

    def __init__(self, output_queue: Queue, normalizer):
        self.q = output_queue
        self.norm = normalizer

    def inject_scenario(self, scenario_name: str, interval_s: float = 1.0):
        """Inject a named fault scenario at specified interval."""
        scenario = self.SCENARIOS.get(scenario_name)
        if not scenario:
            logger.error(f"Unknown scenario: {scenario_name}. Available: {list(self.SCENARIOS.keys())}")
            return

        def _run():
            logger.info(f"Injecting scenario: {scenario_name}")
            for sig_id, value, unit in scenario:
                sig = self.norm.normalize(
                    signal_id=sig_id,
                    value=value,
                    source="FAULT_INJECTOR",
                    unit=unit,
                )
                try:
                    self.q.put_nowait(sig)
                except Exception:
                    pass
                time.sleep(interval_s)
            logger.info(f"Scenario complete: {scenario_name}")

        threading.Thread(target=_run, daemon=True).start()

    def list_scenarios(self) -> list:
        return list(self.SCENARIOS.keys())


# ── Sample CSV Generator ─────────────────────────────────────
def generate_sample_csv(output_path: str = "data/datasets/raw/sample_drive.csv"):
    """Generate a sample drive CSV for testing. Run once to bootstrap."""
    import random
    from datetime import datetime, timezone

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    base_ts = int(time.time() * 1e6) - (3600 * 1_000_000)  # start 1 hour ago
    signals = [
        ("ENGINE_COOLANT_TEMP", 75, 95, "celsius"),
        ("ENGINE_RPM", 800, 4000, "rpm"),
        ("PERF_VEHICLE_SPEED", 0, 120, "km/h"),
        ("FUEL_LEVEL", 60, 40, "%"),
        ("BATTERY_VOLTAGE", 12.0, 14.2, "V"),
        ("OIL_PRESSURE", 40, 70, "kPa"),
        ("TIRE_PRESSURE_FL", 30, 33, "kPa"),
    ]

    header = ["timestamp_us", "signal_id", "value", "unit", "source"]
    rows = []
    ts = base_ts

    for _ in range(1000):
        ts += random.randint(100_000, 500_000)  # 100ms–500ms steps
        for sig_id, lo, hi, unit in signals:
            val = round(random.uniform(lo, hi), 2)
            rows.append([ts, sig_id, val, unit, "REPLAY"])

    # Inject overheat event at midpoint
    mid_ts = base_ts + (1800 * 1_000_000)
    rows.append([mid_ts, "ENGINE_COOLANT_TEMP", 108.5, "celsius", "REPLAY"])
    rows.append([mid_ts + 5_000_000, "ENGINE_COOLANT_TEMP", 115.0, "celsius", "REPLAY"])

    rows.sort(key=lambda r: r[0])  # sort numerically by timestamp

    with open(output_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        writer.writerows(rows)

    logger.info(f"Sample CSV generated: {output_path} ({len(rows)-1} rows)")
    return output_path


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser(description="VehicleGPT Log Replayer")
    parser.add_argument("--generate-sample", action="store_true",
                        help="Generate a sample drive CSV for testing")
    parser.add_argument("--file", default="data/datasets/raw/sample_drive.csv")
    parser.add_argument("--speed", type=float, default=5.0)
    args = parser.parse_args()

    if args.generate_sample:
        path = generate_sample_csv()
        print(f"Sample CSV generated at: {path}")
