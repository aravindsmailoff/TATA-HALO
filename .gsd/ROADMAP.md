---
milestone: v1.0-cockpit-edge-ai
version: 1.0.0
updated: 2026-10-17T21:13:00Z
---

# ROADMAP.md — Project Roadmap: TATA HALO / VehicleGPT

> **Current Phase:** Phase 4 — Unified Glassmorphic HUD & Independent Scroll
> **Status:** Verifying & Polishing

---

## Must-Haves (from SPEC)
- [x] Photorealistic 3D Tata Punch WebGL visualization synchronized to Lenis smooth scroll.
- [x] Continuous CAN physics replay engine streaming 1,000 frames (1s/step) with full playback controls.
- [x] Local Ollama `llama3:latest` integration with live vehicle context injection.
- [x] Obsidian Glass luxury HUD with dual symmetric cards for live telemetry and AI diagnostics.
- [x] Dedicated internal chat scroll with `data-lenis-prevent` and wheel event isolation.

---

## Phases

### Phase 1: 3D WebGL Vehicle Experience & Lenis Smooth Flow
**Status:** ✅ Complete
**Objective:** Deliver the interactive Tata Punch 3D model with smooth orbit controls, day/night transitions, preloader, and parallax mountain backdrop.
**Requirements:** REQ-01

**Deliverables:**
- [x] GLTFLoader pipeline with shadow casting and studio reflections.
- [x] Lenis scroll driver with virtual 1200vh timeline.
- [x] Dual-tone factory color switchers (Orcus White, Daytona Grey, Atomic Orange).

---

### Phase 2: CAN Telemetry Replay Engine & Continuous Physics Dataset
**Status:** ✅ Complete
**Objective:** Replace random static telemetry with a continuous, 1,000-frame physics-based drive cycle replay.
**Requirements:** REQ-02

**Deliverables:**
- [x] Generate 1,000 smooth frames (7,000 rows, 1s steps) in `sample_drive.csv`.
- [x] Implement `/api/telemetry` with play, pause, step (±10s), reset, and scrubber seek actions.
- [x] Active playback polling loop with instant UI state synchronization.

---

### Phase 3: Edge LLM & Local Ollama Diagnostic Copilot
**Status:** ✅ Complete
**Objective:** Connect conversational query interface to on-device GPU inference (Llama 3 via Ollama) with live CAN bus context injection.
**Requirements:** REQ-03

**Deliverables:**
- [x] Multi-strategy query pipeline in `/api/query` (Ollama Llama 3 -> VehicleGPT -> Local rule fallback).
- [x] Real-time CAN bus telemetry prompt injection with speed, RPM, gear, fuel, coolant, battery, TPMS.
- [x] Dynamic latency and model provenance tags displayed on response bubbles.

---

### Phase 4: Unified Glassmorphic HUD & Independent Chat Scroll
**Status:** ✅ Complete
**Objective:** Eliminate visual mismatch between cards and isolate internal chat log scrolling from the global Lenis page timeline.
**Requirements:** REQ-04, REQ-05

**Deliverables:**
- [x] Obsidian Glass cockpit theme (`background: radial-gradient(...)`) with `48px` blur.
- [x] Symmetrical 610px height cards with custom cyan/emerald glowing borders.
- [x] Independent chat scroll via `data-lenis-prevent="true"`, `overscroll-behavior: contain !important;`, and wheel event isolation.
- [x] Multi-gauge cluster (Speedometer, Tachometer, Fuel & Range, Coolant, 12V Battery, Oil Pressure, TPMS).

---

### Phase 5: Automated Testing, CodeRabbit Review & Ralph Loop Optimization
**Status:** 🔄 In Progress
**Objective:** Configure autonomous review loops (CodeRabbit), Roo Code rules, automated regression tests, and responsive mobile tuning.
**Requirements:** REQ-05

**Deliverables:**
- [x] GSD tracking files (`SPEC.md`, `ROADMAP.md`, `TASKS.md`, `STATE.md`).
- [ ] CodeRabbit configuration (`.coderabbit.yaml`) for automated architectural and syntax reviews.
- [ ] Roo Code mode configuration (`.roomodes`, `.clinerules`) for multi-agent pair programming.
- [ ] Mobile viewport audit and touch interaction tuning for low-power devices.

---

## Progress Summary

| Phase | Title | Status | Plans Completed |
|---|---|:---:|:---:|
| **1** | 3D WebGL Vehicle Experience | ✅ Complete | 3 / 3 |
| **2** | CAN Telemetry Replay Engine | ✅ Complete | 3 / 3 |
| **3** | Edge LLM & Ollama Diagnostic Copilot | ✅ Complete | 3 / 3 |
| **4** | Unified Glassmorphic HUD & Scroll | ✅ Complete | 4 / 4 |
| **5** | Tooling Integration & Performance Tuning | 🔄 In Progress | 2 / 4 |

---

*Last updated: 2026-10-17*
