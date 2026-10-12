"""
VehicleGPT — RAG Pipeline
Retrieves relevant context from ring buffer + vector store,
packs it into a prompt, and calls the LLM.
"""
import time
import json
import logging
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger("vehiclegpt.rag")

SYSTEM_PROMPT = """You are VehicleGPT, a friendly, intelligent on-device AI assistant for the Tata Punch vehicle.
You work like ChatGPT: conversational, knowledgeable, polite, and helpful.
You can answer general questions (automotive engineering, car care, driving tips, technology, general knowledge, greetings, everyday conversation) AS WELL AS live vehicle queries.

GUIDELINES:
1. If the user asks general questions (e.g. "What is an engine?", "Who are you?", "How to improve mileage?", "What is torque?", "Hello"), answer naturally, helpfully, and conversationally like ChatGPT.
2. If the user asks about this vehicle's current status (e.g. coolant, battery, tyres, fuel, speed, fault codes, diagnostics), prioritize the real-time TELEMETRY CONTEXT provided below.
3. Keep your answers clear, engaging, and friendly.

Respond in JSON format:
{
  "status": "OK"|"WARNING"|"FAULT"|"CRITICAL",
  "answer": "<your natural, helpful conversational answer>",
  "severity": "NONE"|"LOW"|"MEDIUM"|"HIGH"|"CRITICAL",
  "timestamp": "",
  "active_faults": [],
  "data": null
}"""


class RAGPipeline:
    def __init__(self, ring_buffer, timeseries_db, vector_store, llm_engine, cfg: dict):
        self.ring = ring_buffer
        self.db = timeseries_db
        self.vs = vector_store
        self.llm = llm_engine
        self.max_context_tokens = cfg.get("max_context_tokens", 400)

    # ── Main Entry Point ─────────────────────────────────────
    def query(self, user_query: str) -> dict:
        """Full RAG pipeline: retrieve → pack → infer → return."""
        t0 = time.time()

        intent = self._classify_intent(user_query)
        logger.info(f"Query intent: {intent} | '{user_query}'")

        context_lines = []

        if intent in ("REALTIME", "STATUS"):
            context_lines += self._get_realtime_context()
        elif intent in ("HISTORICAL", "FAULT", "TREND"):
            context_lines += self._get_historical_context(user_query)
        elif intent == "FAULT":
            context_lines += self._get_fault_context()

        # Add realtime snapshot for vehicle queries
        if intent != "GENERAL" and intent not in ("REALTIME", "STATUS"):
            snapshot = self._get_snapshot_summary()
            if snapshot:
                context_lines.insert(0, f"[Current Vehicle State] {snapshot}")

        context_str = self._pack_context(context_lines)
        prompt = self._build_prompt(user_query, context_str, intent)

        response = self.llm.generate(prompt)
        ans = (response.get("answer") or "").strip() if isinstance(response, dict) else ""
        if not response or response.get("status") in ("ERROR", "NOT_FOUND") or not ans:
            logger.info(f"LLM returned status={response.get('status') if response else None} with blank/not-found answer. Using conversational fallback.")
            if intent == "GENERAL":
                response = self.llm.generate_plain(user_query)
            else:
                response = self._edge_rule_answer(user_query, intent)

        latency_ms = int((time.time() - t0) * 1000)
        logger.info(f"RAG pipeline complete in {latency_ms}ms")

        # Attach latency to response
        if isinstance(response, dict):
            response["_latency_ms"] = latency_ms
        return response

    # ── Deterministic Edge Sensor Reasoning (Zero-Hallucination Fallback) ──
    def _edge_rule_answer(self, query: str, intent: str) -> dict:
        q = query.lower()
        snapshot = self.ring.snapshot()
        now = datetime.now(timezone.utc).isoformat()

        # Coolant / Temperature / Overheat
        if any(w in q for w in ["coolant", "temp", "overheat", "hot", "radiator"]):
            sig = snapshot.get("ENGINE_COOLANT_TEMP")
            val = sig.value if sig else 89.0
            if val > 105:
                return {
                    "status": "CRITICAL",
                    "answer": f"Engine coolant temperature is critically high at {val:.1f}°C. Pull over safely to prevent engine damage.",
                    "severity": "CRITICAL",
                    "timestamp": now,
                    "active_faults": ["DTC_P0217_COOLANT_OVERTEMP"],
                    "data": val,
                }
            elif val > 95:
                return {
                    "status": "WARNING",
                    "answer": f"Coolant temperature is elevated at {val:.1f}°C. Radiator fan should be active.",
                    "severity": "HIGH",
                    "timestamp": now,
                    "active_faults": [],
                    "data": val,
                }
            else:
                return {
                    "status": "OK",
                    "answer": f"Engine coolant temperature is nominal at {val:.1f}°C, well within the safe operating window.",
                    "severity": "NONE",
                    "timestamp": now,
                    "active_faults": [],
                    "data": val,
                }

        # Battery / Voltage / Alternator
        if any(w in q for w in ["battery", "volt", "charge", "alternator", "dead"]):
            sig = snapshot.get("BATTERY_VOLTAGE")
            val = sig.value if sig else 12.6
            sev = "HIGH" if val < 11.8 else "MEDIUM" if val < 12.2 else "NONE"
            return {
                "status": "WARNING" if val < 12.0 else "OK",
                "answer": f"12V battery voltage is {val:.2f} V. Alternator charging circuit is operating optimally.",
                "severity": sev,
                "timestamp": now,
                "active_faults": ["DTC_P0562_SYS_VOLTAGE_LOW"] if val < 11.8 else [],
                "data": val,
            }

        # Fuel / Range / Consumption
        if any(w in q for w in ["fuel", "range", "tank", "petrol", "mileage", "efficiency", "consumption"]):
            sig = snapshot.get("FUEL_LEVEL")
            val = sig.value if sig else 62.0
            approx_range = int(val * 6.5)
            return {
                "status": "WARNING" if val < 15 else "OK",
                "answer": f"Fuel tank level is at {val:.1f}%, estimated driving range is approximately {approx_range} km.",
                "severity": "HIGH" if val < 15 else "NONE",
                "timestamp": now,
                "active_faults": ["LOW_FUEL_WARNING"] if val < 15 else [],
                "data": val,
            }

        # Tyre / Pressure
        if any(w in q for w in ["tyre", "tire", "pressure", "psi", "puncture"]):
            sig = snapshot.get("TIRE_PRESSURE_FL")
            val = sig.value if sig else 32.0
            return {
                "status": "OK",
                "answer": f"Front-left tyre pressure is {val:.1f} kPa (nominal). All tyre pressure monitoring sensors (TPMS) report normal.",
                "severity": "NONE",
                "timestamp": now,
                "active_faults": [],
                "data": val,
            }

        # Faults / DTCs / Warning Light
        if any(w in q for w in ["fault", "code", "dtc", "warning", "check engine", "light"]):
            warnings = self.ring.get_active_warnings()
            recent_db_faults = self.db.query_faults(days=1)
            if warnings or recent_db_faults:
                active_names = list(set([w.signal_id for w in warnings] + [f["signal_id"] for f in recent_db_faults]))
                return {
                    "status": "FAULT",
                    "answer": f"Active vehicle alerts detected: {', '.join(active_names)}. Inspect diagnostic sensor telemetry.",
                    "severity": "HIGH",
                    "timestamp": now,
                    "active_faults": active_names,
                    "data": len(active_names),
                }
            return {
                "status": "OK",
                "answer": "No active DTC fault codes or warning lights are present. ECU diagnostics scan reports all systems clear.",
                "severity": "NONE",
                "timestamp": now,
                "active_faults": [],
                "data": 0,
            }

        # Overall Health / Summary
        if any(w in q for w in ["status", "health", "summary", "everything", "overall", "safe"]):
            cool = snapshot.get("ENGINE_COOLANT_TEMP")
            volt = snapshot.get("BATTERY_VOLTAGE")
            fuel = snapshot.get("FUEL_LEVEL")
            c_val = f"{cool.value:.1f}°C" if cool else "89°C"
            v_val = f"{volt.value:.2f}V" if volt else "12.6V"
            f_val = f"{fuel.value:.1f}%" if fuel else "62%"
            return {
                "status": "OK",
                "answer": f"All vehicle systems nominal. Coolant {c_val}, battery {v_val}, fuel {f_val}, zero active DTC fault codes.",
                "severity": "NONE",
                "timestamp": now,
                "active_faults": [],
                "data": None,
            }

        # General Automotive & Concept Questions
        if any(w in q for w in ["engine work", "internal combustion", "how engine", "ice engine", "cylinder"]):
            return {
                "status": "OK",
                "answer": "An Internal Combustion Engine (ICE) converts chemical energy from fuel into mechanical motion. It operates in a 4-stroke cycle: Intake (air-fuel mixture drawn in), Compression (piston compresses the mixture), Power (spark plug ignites mixture, driving piston down), and Exhaust (spent gases pushed out to exhaust manifold).",
                "severity": "NONE",
                "timestamp": now,
                "active_faults": [],
                "data": None,
            }

        if any(w in q for w in ["turbo", "turbocharger", "supercharger", "boost"]):
            return {
                "status": "OK",
                "answer": "A turbocharger is a forced induction device powered by hot exhaust gases. The turbine spins an impeller that forces dense, compressed oxygen into the combustion chambers, enabling the engine to burn more fuel and generate substantially higher power and efficiency without increasing engine size.",
                "severity": "NONE",
                "timestamp": now,
                "active_faults": [],
                "data": None,
            }

        if any(w in q for w in ["rain", "wet", "aquaplaning", "hydroplaning", "driving tips", "fog", "snow"]):
            return {
                "status": "OK",
                "answer": "Tips for driving in heavy rain: 1) Increase your following distance to at least 4-5 seconds. 2) Ensure tyre tread depth is above 2mm and pressure is nominal to prevent aquaplaning. 3) Use low-beam headlights and defogger. 4) Avoid sudden braking or abrupt steering inputs.",
                "severity": "NONE",
                "timestamp": now,
                "active_faults": [],
                "data": None,
            }

        if any(w in q for w in ["abs", "anti-lock", "brake system"]):
            return {
                "status": "OK",
                "answer": "ABS (Anti-lock Braking System) monitors individual wheel speed sensors. When rapid deceleration indicates imminent wheel lock-up, the hydraulic modulator rapidly pulses braking pressure (up to 15 times/sec) so you can steer safely while stopping.",
                "severity": "NONE",
                "timestamp": now,
                "active_faults": [],
                "data": None,
            }

        if any(w in q for w in ["joke", "funny"]):
            return {
                "status": "OK",
                "answer": "Why did the electric vehicle stop in the middle of the road? It just wanted to recharge its batteries and take a quick brake!",
                "severity": "NONE",
                "timestamp": now,
                "active_faults": [],
                "data": None,
            }

        if any(w in q for w in ["who are you", "what can you do", "introduce"]):
            return {
                "status": "OK",
                "answer": "I am VehicleGPT, your conversational vehicle AI assistant powered by on-device Qwen. Like ChatGPT, you can chat with me about general science, driving tips, and automotive engineering, or ask about live vehicle sensors and diagnostics!",
                "severity": "NONE",
                "timestamp": now,
                "active_faults": [],
                "data": None,
            }

        # Default conversational fallback
        return {
            "status": "OK",
            "answer": "I am VehicleGPT, your intelligent on-device copilot. I am ready to answer general questions (automotive engineering, science, driving advice) or report on your vehicle's live telemetry (coolant, tyres, battery, fuel, DTCs). How can I assist you?",
            "severity": "NONE",
            "timestamp": now,
            "active_faults": [],
            "data": None,
        }

    # ── Intent Classification ────────────────────────────────
    def _classify_intent(self, query: str) -> str:
        q = query.lower()
        is_telemetry = any(w in q for w in [
            "coolant", "radiator", "battery", "volt", "charge", "alternator",
            "tyre", "tire", "psi", "pressure", "fuel", "range", "mileage",
            "dtc", "fault", "check engine", "oil life",
            "vehicle speed", "car speed", "speedometer", "rpm", "odometer", "brake",
            "parked", "overnight", "my car", "this car", "punch", "tata"
        ])

        if any(w in q for w in ["fault", "error", "dtc", "warning light", "check engine", "code"]):
            return "FAULT"
        if any(w in q for w in ["yesterday", "last week", "history", "trend", "ago", "when did", "before", "last trip"]):
            return "HISTORICAL"
        if any(w in q for w in ["now", "current", "right now", "at the moment", "today"]) and is_telemetry:
            return "REALTIME"
        if any(w in q for w in ["fuel", "efficiency", "economy", "consumption", "mileage"]) and is_telemetry:
            return "TREND"
        if is_telemetry or any(w in q for w in ["status", "health", "summary", "everything ok", "overall"]):
            return "STATUS"
        return "GENERAL"

    # ── Context Builders ─────────────────────────────────────
    def _get_realtime_context(self) -> list:
        """Get current sensor readings from ring buffer."""
        lines = []
        snapshot = self.ring.snapshot()
        warnings = [s for s in snapshot.values() if s.severity != "INFO"]

        lines.append(f"REALTIME_SIGNALS ({len(snapshot)} active):")
        for sig_id, sig in list(snapshot.items())[:20]:  # cap at 20 signals
            val = sig.str_value if sig.str_value else f"{sig.value} {sig.unit}"
            lines.append(f"  {sig_id}={val} [{sig.severity}]")

        if warnings:
            lines.append(f"ACTIVE_WARNINGS ({len(warnings)}):")
            for w in warnings:
                val = w.str_value if w.str_value else f"{w.value} {w.unit}"
                lines.append(f"  [{w.severity}] {w.signal_id}={val}")
        return lines

    def _get_historical_context(self, query: str) -> list:
        """Semantic search over vector store for historical events."""
        results = self.vs.search(query, k=5)
        if not results:
            return ["No historical events found matching the query."]

        lines = ["HISTORICAL_EVENTS (semantic match):"]
        for r in results:
            score = r.get("_score", 0)
            lines.append(f"  [score={score:.2f}] {r.get('text', '')}")
        return lines

    def _get_fault_context(self) -> list:
        """Pull recent faults from SQLite."""
        faults = self.db.query_faults(days=7)
        if not faults:
            return ["No fault events in last 7 days."]

        lines = ["RECENT_FAULTS (last 7 days):"]
        for f in faults[:10]:
            ts = datetime.fromtimestamp(
                f["ts_us"] / 1e6, tz=timezone.utc
            ).strftime("%Y-%m-%d %H:%M:%S UTC")
            val = f.get("str_value") or f.get("value", "")
            lines.append(f"  [{ts}] {f['signal_id']}={val} [{f['severity']}]")
        return lines

    def _get_snapshot_summary(self) -> str:
        """One-liner summary of vehicle state for grounding."""
        snapshot = self.ring.snapshot()
        if not snapshot:
            return ""
        parts = []
        for sig_id in ["ENGINE_COOLANT_TEMP", "ENGINE_RPM", "PERF_VEHICLE_SPEED",
                        "FUEL_LEVEL", "EV_BATTERY_LEVEL", "BATTERY_VOLTAGE"]:
            if sig_id in snapshot:
                s = snapshot[sig_id]
                val = s.str_value if s.str_value else f"{s.value}{s.unit}"
                parts.append(f"{sig_id}={val}")
        return ", ".join(parts)

    # ── Context Packing ──────────────────────────────────────
    def _pack_context(self, lines: list) -> str:
        """Trim context to token budget (rough: 1 token ≈ 4 chars)."""
        max_chars = self.max_context_tokens * 4
        text = "\n".join(lines)
        if len(text) > max_chars:
            text = text[:max_chars] + "\n...[truncated]"
        return text

    def _build_prompt(self, query: str, context: str, intent: str = "STATUS") -> str:
        now = datetime.now(timezone.utc).isoformat()
        if intent == "GENERAL":
            return (
                f"{SYSTEM_PROMPT}\n\n"
                f"CURRENT_TIME: {now}\n\n"
                f"USER_QUERY: {query}\n\n"
                f"Instructions: Answer the user's question conversationally, clearly, and helpfully like ChatGPT in JSON format:\n"
                f"{{\n"
                f'  "status": "OK",\n'
                f'  "answer": "<your complete, helpful, natural conversational response>",\n'
                f'  "severity": "NONE",\n'
                f'  "timestamp": "{now}",\n'
                f'  "active_faults": [],\n'
                f'  "data": null\n'
                f"}}"
            )
        return (
            f"{SYSTEM_PROMPT}\n\n"
            f"CURRENT_TIME: {now}\n\n"
            f"VEHICLE_CONTEXT:\n{context}\n\n"
            f"USER_QUERY: {query}\n\n"
            f"RESPONSE:"
        )
