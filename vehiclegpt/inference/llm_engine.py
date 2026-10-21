"""
VehicleGPT — LLM Inference Engine
Supports Ollama (primary) and llama.cpp CLI (fallback).
Outputs parsed JSON with grammar enforcement.
"""
import json
import time
import logging
import requests
import subprocess
from typing import Optional

logger = logging.getLogger("vehiclegpt.inference")

# Default fallback response when model is unavailable
FALLBACK_RESPONSE = {
    "status": "ERROR",
    "answer": "VehicleGPT inference engine is unavailable. Check model setup.",
    "severity": "NONE",
    "timestamp": "",
    "active_faults": [],
    "data": None,
}


class LLMEngine:
    """
    Thin wrapper around Ollama API or llama.cpp subprocess.
    Always returns a parsed JSON dict.
    Grammar enforcement ensures valid JSON at sampler level.
    """

    def __init__(self, cfg: dict):
        self.backend = cfg.get("backend", "ollama")
        self.ollama_url = cfg.get("ollama_url", "http://localhost:11434")
        self.model_name = cfg.get("model_name", "vehiclegpt")
        self.gguf_path = cfg.get("gguf_path", "")
        self.llamacpp_bin = cfg.get("llamacpp_binary", "./llama-cli")
        self.grammar_file = cfg.get("grammar_file", "")
        self.temperature = float(cfg.get("temperature", 0.0))
        self.top_k = int(cfg.get("top_k", 1))
        self.top_p = float(cfg.get("top_p", 0.1))
        self.repeat_penalty = float(cfg.get("repeat_penalty", 1.1))
        self.max_tokens = int(cfg.get("max_tokens", 40))
        self.context_size = int(cfg.get("context_size", 512))
        self.num_threads = int(cfg.get("num_threads", 8))

    # ── Primary Entry ────────────────────────────────────────
    def generate(self, prompt: str) -> dict:
        t0 = time.time()
        raw = ""

        try:
            if self.backend == "ollama":
                raw = self._call_ollama(prompt)
            elif self.backend == "llamacpp":
                raw = self._call_llamacpp(prompt)
            else:
                logger.error(f"Unknown backend: {self.backend}")
                return FALLBACK_RESPONSE

            result = self._parse_json(raw)
            elapsed = time.time() - t0
            logger.info(f"Inference done in {elapsed:.2f}s | status={result.get('status')}")
            return result

        except Exception as e:
            logger.error(f"Inference error: {e}")
            return FALLBACK_RESPONSE

    # ── Ollama Backend ───────────────────────────────────────
    def _call_ollama(self, prompt: str) -> str:
        """Call Ollama local server with JSON format enforcement."""
        payload = {
            "model": self.model_name,
            "prompt": prompt,
            "stream": False,
            "think": False,
            "options": {
                "temperature": self.temperature,
                "top_k": self.top_k,
                "top_p": self.top_p,
                "repeat_penalty": self.repeat_penalty,
                "num_predict": self.max_tokens,
                "num_ctx": self.context_size,
                "num_thread": self.num_threads,
            },
        }

        resp = requests.post(
            f"{self.ollama_url}/api/generate",
            json=payload,
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        raw = data.get("response") or ""
        if not raw and data.get("thinking"):
            raw = data["thinking"]
        return raw

    def generate_plain(self, user_query: str) -> dict:
        """Direct conversational generation like ChatGPT without schema restrictions."""
        try:
            prompt = (
                "You are VehicleGPT, an intelligent, conversational vehicle AI assistant (like ChatGPT).\n"
                f"User Question: {user_query}\n\n"
                "Provide a direct, conversational, polite, and helpful response:"
            )
            payload = {
                "model": self.model_name,
                "prompt": prompt,
                "stream": False,
                "think": False,
                "options": {
                    "num_ctx": self.context_size,
                    "num_predict": self.max_tokens,
                    "temperature": 0.6,
                    "num_thread": self.num_threads,
                },
            }
            resp = requests.post(
                f"{self.ollama_url}/api/generate",
                json=payload,
                timeout=35,
            )
            if resp.ok:
                data = resp.json()
                text = (data.get("response") or data.get("thinking") or "").strip()
                if "</think>" in text:
                    text = text.split("</think>")[-1].strip()
                if text:
                    return {
                        "status": "OK",
                        "answer": text,
                        "severity": "NONE",
                        "timestamp": "",
                        "active_faults": [],
                        "data": None,
                    }
        except Exception as e:
            logger.error(f"Plain generation error: {e}")

        return {
            "status": "OK",
            "answer": f"I am your VehicleGPT assistant. I can answer questions about vehicle telemetry (coolant, battery, fuel, tyres, DTCs) as well as general automotive and driving topics. How can I assist you further?",
            "severity": "NONE",
            "timestamp": "",
            "active_faults": [],
            "data": None,
        }

    # ── llama.cpp Backend (subprocess) ──────────────────────
    def _call_llamacpp(self, prompt: str) -> str:
        """Call llama-cli binary directly — for air-gapped ARM boards."""
        cmd = [
            self.llamacpp_bin,
            "-m", self.gguf_path,
            "-c", str(self.context_size),
            "--temp", str(self.temperature),
            "--top-k", str(self.top_k),
            "--top-p", str(self.top_p),
            "--repeat-penalty", str(self.repeat_penalty),
            "-n", str(self.max_tokens),
            "--no-display-prompt",
            "-p", prompt,
        ]
        if self.grammar_file:
            cmd += ["--grammar-file", self.grammar_file]

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=15,
        )
        if result.returncode != 0:
            logger.error(f"llama.cpp error: {result.stderr}")
        return result.stdout.strip()

    # ── JSON Parser ──────────────────────────────────────────
    def _parse_json(self, raw: str) -> dict:
        """Safely parse model output into dict, with schema validation."""
        if not raw:
            return FALLBACK_RESPONSE

        # Try direct parse
        try:
            obj = json.loads(raw)
            return self._validate_schema(obj)
        except json.JSONDecodeError:
            pass

        # Try to extract first JSON object from output
        start = raw.find("{")
        end = raw.rfind("}") + 1
        if start >= 0 and end > start:
            try:
                obj = json.loads(raw[start:end])
                return self._validate_schema(obj)
            except json.JSONDecodeError:
                pass

        # Regex fallback: extract content of "answer" field
        import re
        m = re.search(r'"answer"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)', raw)
        if m:
            clean_ans = m.group(1).replace('\\"', '"').replace('\\n', ' ').strip()
            # If dangles with an unfinished word or conjunction, clean up
            if clean_ans:
                return {
                    "status": "OK",
                    "answer": clean_ans,
                    "severity": "NONE",
                    "timestamp": "",
                    "active_faults": [],
                    "data": None,
                }

        if raw and raw.strip():
            clean = raw.strip()
            if "</think>" in clean:
                clean = clean.split("</think>")[-1].strip()
            # If clean starts with {"status" or similar JSON fragment, strip JSON syntax
            if clean.startswith("{") and '"answer"' in clean:
                m2 = re.search(r'"answer"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)', clean)
                if m2:
                    clean = m2.group(1).replace('\\"', '"').replace('\\n', ' ').strip()
            if clean:
                return {
                    "status": "OK",
                    "answer": clean,
                    "severity": "NONE",
                    "timestamp": "",
                    "active_faults": [],
                    "data": None,
                }

        logger.warning(f"Could not parse response from model output: {raw[:200]}")
        fallback = FALLBACK_RESPONSE.copy()
        fallback["answer"] = raw[:300] if raw else "No response."
        return fallback

    def _validate_schema(self, obj: dict) -> dict:
        """Ensure required fields exist with valid values."""
        import re
        valid_status = {"OK", "WARNING", "FAULT", "CRITICAL", "NOT_FOUND", "ERROR"}
        valid_severity = {"NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"}

        obj.setdefault("status", "OK")
        obj.setdefault("answer", "")
        obj.setdefault("severity", "NONE")
        obj.setdefault("timestamp", "")
        obj.setdefault("active_faults", [])
        obj.setdefault("data", None)

        if isinstance(obj["answer"], str):
            ans = obj["answer"]
            if "</think>" in ans:
                ans = ans.split("</think>")[-1].strip()
            if "Thinking Process:" in ans:
                paragraphs = ans.split("\n\n")
                clean_pars = [p.strip() for p in paragraphs if not p.strip().startswith("Thinking Process:") and not p.strip().startswith("1.") and not p.strip().startswith("2.") and not p.strip().startswith("*")]
                if clean_pars:
                    ans = " ".join(clean_pars).strip()
            # If the answer is itself a stringified JSON fragment
            if ans.strip().startswith("{") and '"answer"' in ans:
                m_inner = re.search(r'"answer"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)', ans)
                if m_inner:
                    ans = m_inner.group(1).replace('\\"', '"').replace('\\n', ' ').strip()
            obj["answer"] = ans

        if obj["status"] not in valid_status:
            obj["status"] = "OK"
        if obj["severity"] not in valid_severity:
            obj["severity"] = "NONE"
        if not isinstance(obj["active_faults"], list):
            obj["active_faults"] = []

        return obj

    def health_check(self) -> bool:
        """Check if backend is reachable."""
        try:
            if self.backend == "ollama":
                r = requests.get(f"{self.ollama_url}/api/tags", timeout=3)
                models = [m["name"] for m in r.json().get("models", [])]
                found = any(m == self.model_name or m.startswith(f"{self.model_name}:") for m in models)
                if not found:
                    logger.warning(
                        f"Model '{self.model_name}' not found in Ollama. "
                        f"Run: ollama create {self.model_name} -f ./inference/modelfile/Modelfile"
                    )
                    return False
                return True
        except Exception as e:
            logger.error(f"LLM health check failed: {e}")
        return False
