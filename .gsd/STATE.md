# STATE.md — Project Memory & System State

> Project Memory for Antigravity AI, Roo Code, CodeRabbit, and Ralph Loop.

---

## 🎯 Current Position
- **Active Milestone**: `v1.0-cockpit-edge-ai`
- **Current Phase**: Phase 4 & 5
- **Branch**: `main`
- **Server Status**:
  - Next.js 14 Dev Server: **Running** on `http://localhost:3000`
  - Ollama Service: **Running** on `http://localhost:11434` with model `llama3:latest` (GPU-accelerated)
  - Telemetry API: **Active** at `/api/telemetry` streaming continuous 1,000-frame drive cycle
  - AI Query Engine: **Active** at `/api/query`

---

## 🧠 Key Decisions (ADR Summary)
1. **Local Edge Inference Over Cloud API**:
   - *Rationale*: Telemetry data contains sensitive vehicular coordinates and driving habits. Edge execution via local Ollama ensures zero data exfiltration, privacy, and eliminates subscription API costs.
2. **Physics Replay Over Random Math**:
   - *Rationale*: Random values cause the LLM to output nonsensical diagnostics (e.g. 5000 RPM at 0 km/h in 5th gear). 1,000 continuous physics steps ensure realistic gear-speed-rpm relationships.
3. **Lenis Scroll Prevention (`data-lenis-prevent`)**:
   - *Rationale*: The 1200vh Lenis window scroll intercepted mouse wheel gestures inside the chat log. Applying `data-lenis-prevent="true"` and `e.stopPropagation()` guarantees clean, separate nested scrolling.
4. **Unified Obsidian Glassmorphism**:
   - *Rationale*: Light/dark card mismatch caused visual distraction. Dual 610px height capsules with matching dark frosted glass creates an authentic supercar telemetry aesthetic.

---

## ⚠️ Known Blockers / Risks
- None. All compile targets passing with zero errors (479 modules).

---

## 🧠 CDM Wave Summary — Constrained Decoding Model v1.0

**Objective:** Replace the fragile `indexOf('{')` JSON-scraping approach with a true grammar-constrained LLM output layer.

**Changes:**
- `src/lib/cdm/schema.js` — `RESPONSE_SCHEMA` (JSON Schema), `normalizeTelemetryFrame()`, `cdmToLLMContext()`, `validateResponse()`
- `src/lib/cdm/decoder.js` — `buildConstrainedPayload()` (injects `format: RESPONSE_SCHEMA` into Ollama), `decodeConstrainedResponse()`, `synthesizeFallback()`, `callConstrainedDecoding()`
- `src/app/api/telemetry/route.js` — All GET/POST responses wrapped through `normalizeTelemetryFrame()`, `X-CDM-Version: 1.0` header on every response
- `src/app/api/query/route.js` — Ollama path replaced: `format: RESPONSE_SCHEMA` constrained decoding, local fallback wrapped in `synthesizeFallback()` for uniform shape
- `src/components/HaloCarExperience.jsx` — `CDM v1.0 ✓` emerald badge added to cockpit chat status bar

**Verification:**
- `GET /api/telemetry` → CDMFrame with `cdm_version: "1.0"` + `X-CDM-Version: 1.0` header
- `POST /api/query` → `_source: "ollama_cdm"`, `_cdm_version: "1.0"`, no JSON scraping
- Local fallback → same shape via `synthesizeFallback()`

**Key CDM mechanism:**
```json
{
  "model": "vehiclegpt",
  "format": { /* RESPONSE_SCHEMA — full JSON Schema object */ },
  "options": { "temperature": 0.05, "num_predict": 180 }
}
```
The Ollama sampler assigns `p=0` to any token that would break schema validity before softmax — output is structurally guaranteed.

**Next Wave TODO:**
- Add `persistFrame(cdmFrame)` to write session frames to `datasets/session_log.jsonl` for replay analytics

