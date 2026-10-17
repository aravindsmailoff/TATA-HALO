# SPEC.md — Project Specification: TATA HALO / VehicleGPT

> **Status**: `FINALIZED`
> **Project**: Tata Halo (VehicleGPT)
> **Author**: Antigravity AI Engine
> **Platform**: Next.js 14, Three.js, WebGL, Ollama (Llama 3), CAN-Bus OBD-II Simulation

---

## 1. Vision
Tata Halo (VehicleGPT) is an ultra-premium, interactive 3D automotive experience and on-device edge AI diagnostic copilot for the Tata Punch (1.2L Revotron). It demonstrates real-time vehicular telemetry streaming through simulated CAN bus frames, instantaneous Edge LLM generative reasoning via local Llama 3 on GPU, and an award-winning glassmorphic digital cockpit interface.

---

## 2. Goals
1. **Photorealistic 3D Model & Flow UI**: Render the Tata Punch GLB model with smooth orbit controls, lighting handoff, and scenic mountain road parallax driven by Lenis smooth scrolling.
2. **Continuous Physics CAN Bus Replay**: Stream continuous vehicle vitals (Speed, RPM, Gear, Fuel, Coolant, 12V Battery, Oil Pressure, 4-wheel TPMS) from a 1,000-frame (1s/step) physics-based dataset with Play, Pause, Step ±10s, and Scrubber Seeking.
3. **Conversational Edge Vehicle Diagnostics**: Connect live sensor frames directly to local Ollama (`llama3:latest` on GPU) with zero-latency fallback, answering vehicle science, driving tips, and diagnostic queries.
4. **Unified Luxury Glass Cockpit**: Deliver an Obsidian Glass HUD with dual symmetrical cards (CAN Bus Replay Engine on left, AI Diagnostic Chat on right) with completely isolated internal chat scrolling.
5. **Zero-Crash Resilience**: Ensure 100% uptime with graceful degradation across network, GPU, and fallback local rule engines.

---

## 3. Non-Goals (Out of Scope for v1.0)
- Physical OBD-II hardware bluetooth pairing (emulated via high-frequency CAN replay frames).
- Real-time cloud telemetry synchronization (edge-first architecture to protect driver privacy).
- Multi-vehicle model switching beyond Tata Punch Revotron in the initial release.

---

## 4. Constraints
- **Compute**: Local GPU acceleration for Ollama Llama 3 (`~1-2s` response latency); instant heuristic fallback (<10ms).
- **Scroll Hijacking Prevention**: The global Lenis scroll (1200vh timeline) must NEVER be hijacked when scrolling inside internal containers like the chat log.
- **Portability**: Must run cross-platform on Windows/macOS/Linux with standard Node.js 18+ and Next.js 14 dev servers.

---

## 5. Success Criteria
- [x] Smooth 60 FPS Three.js rendering of the Tata Punch 3D model during scroll transitions.
- [x] 1,000 continuous frames replaying at 1s intervals with functional play, pause, step, seek controls.
- [x] Live LLM answers vehicle queries citing specific live frame metrics (speed, gear, fuel, coolant, battery).
- [x] Chat container has independent internal scrolling (`data-lenis-prevent="true"`) without scrolling the outer page timeline.
- [x] Clean compilation with zero Next.js runtime errors across all components and API routes.

---

## 6. Technical Requirements

| Requirement | Priority | Implementation |
|---|---|---|
| **REQ-01: 3D Scene Flow** | Must-have | Three.js + GLTFLoader + Lenis scroll sync |
| **REQ-02: Telemetry API** | Must-have | `/api/telemetry` GET/POST stateful frame engine |
| **REQ-03: Local LLM Engine**| Must-have | `/api/query` connected to Ollama `llama3:latest` |
| **REQ-04: Digital Cockpit** | Must-have | Dual dark glass capsules with SVG gauge fills |
| **REQ-05: Scroll Isolation**| Must-have | Wheel event cancellation + `overscroll-behavior: contain` |

---

*Last updated: 2026-10-17*
