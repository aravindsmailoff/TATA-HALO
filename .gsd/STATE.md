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
