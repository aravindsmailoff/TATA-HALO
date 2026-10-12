"""
VehicleGPT — CAN / CAN-FD Gateway
Reads from real SocketCAN interface OR virtual vcan0 for simulation.
DBC decoding via cantools. Read-only — no write access to bus.
"""
import time
import logging
import threading
from queue import Queue, Full
from typing import Optional

logger = logging.getLogger("vehiclegpt.can_gateway")


class CANGateway:
    """
    Reads CAN/CAN-FD frames, decodes via DBC file, pushes NormalizedSignal
    to the shared output queue. Read-only — hardware write-back is impossible.
    """

    def __init__(self, config: dict, output_queue: Queue, normalizer):
        self.cfg = config
        self.q = output_queue
        self.norm = normalizer
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._db = None          # cantools DB
        self._bus = None         # python-can Bus

    # ──────────────────────────────────────────────────────────
    def start(self):
        self._load_dbc()
        self._thread = threading.Thread(target=self._run, daemon=True, name="CAN-Gateway")
        self._running = True
        self._thread.start()
        logger.info(f"CAN Gateway started on {self.cfg.get('channel', 'vcan0')}")

    def stop(self):
        self._running = False
        if self._bus:
            try:
                self._bus.shutdown()
            except Exception:
                pass
        logger.info("CAN Gateway stopped.")

    # ──────────────────────────────────────────────────────────
    def _load_dbc(self):
        try:
            import cantools
            dbc_files = self.cfg.get("dbc_files", [])
            if dbc_files:
                self._db = cantools.database.Database()
                for f in dbc_files:
                    try:
                        self._db.add_dbc_file(f)
                        logger.info(f"Loaded DBC: {f}")
                    except Exception as e:
                        logger.warning(f"DBC load failed for {f}: {e}")
            else:
                logger.warning("No DBC files configured — raw IDs will be logged as hex.")
        except ImportError:
            logger.warning("cantools not installed — DBC decoding disabled. Run: pip install cantools")

    def _run(self):
        try:
            import can
        except ImportError:
            logger.error("python-can not installed. Run: pip install python-can")
            return

        interface = self.cfg.get("interface", "socketcan")
        channel = self.cfg.get("channel", "vcan0")
        bitrate = self.cfg.get("bitrate", 500000)
        source_label = "CAN_FD" if self.cfg.get("fd_enabled") else "CAN"

        try:
            self._bus = can.Bus(
                interface=interface,
                channel=channel,
                bitrate=bitrate,
                fd=self.cfg.get("fd_enabled", False),
            )
        except Exception as e:
            logger.error(f"Failed to open CAN bus ({channel}): {e}")
            logger.info("Hint: Use 'replay' mode in config if no real CAN hardware is present.")
            return

        logger.info(f"Listening on {channel} [{interface}]")

        while self._running:
            try:
                msg = self._bus.recv(timeout=1.0)
                if msg is None:
                    continue

                ts_us = int(msg.timestamp * 1e6)

                if self._db:
                    try:
                        decoded = self._db.decode_message(msg.arbitration_id, msg.data)
                        for sig_name, sig_val in decoded.items():
                            unit = self._get_unit(sig_name)
                            normalized = self.norm.normalize(
                                signal_id=sig_name,
                                value=sig_val,
                                source=source_label,
                                unit=unit,
                                timestamp_us=ts_us,
                            )
                            self._push(normalized)
                    except Exception:
                        # Unknown frame — log as raw hex
                        raw_id = f"RAW_0x{msg.arbitration_id:03X}"
                        normalized = self.norm.normalize(
                            signal_id=raw_id,
                            value=msg.data.hex(),
                            source=source_label,
                            unit="hex",
                            timestamp_us=ts_us,
                        )
                        self._push(normalized)
                else:
                    raw_id = f"RAW_0x{msg.arbitration_id:03X}"
                    normalized = self.norm.normalize(
                        signal_id=raw_id,
                        value=msg.data.hex(),
                        source=source_label,
                        unit="hex",
                        timestamp_us=ts_us,
                    )
                    self._push(normalized)

            except Exception as e:
                if self._running:
                    logger.error(f"CAN receive error: {e}")
                    time.sleep(0.1)

    def _push(self, signal):
        try:
            self.q.put_nowait(signal)
        except Full:
            pass  # Drop oldest if queue full — never block ingestion thread

    def _get_unit(self, signal_name: str) -> str:
        """Return unit string from signal name conventions."""
        name = signal_name.upper()
        if "TEMP" in name:
            return "celsius"
        if "RPM" in name:
            return "rpm"
        if "SPEED" in name:
            return "km/h"
        if "PRESSURE" in name:
            return "kPa"
        if "VOLTAGE" in name:
            return "V"
        if "LEVEL" in name or "SOC" in name:
            return "%"
        if "CURRENT" in name:
            return "A"
        if "TORQUE" in name:
            return "Nm"
        return ""
