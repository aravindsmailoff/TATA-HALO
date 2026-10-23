# TATA HALO · VehicleGPT 🚗⚡

**On-Board Edge AI Diagnostic Copilot & CAN Telemetry Digital Twin for Tata Punch & Nexon**

[![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js)](https://nextjs.org/)
[![Ollama](https://img.shields.io/badge/Ollama-Edge%20SLM-blue)](https://ollama.com/)
[![FastAPI](https://img.shields.io/badge/FastAPI-Backend-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![Common Data Model](https://img.shields.io/badge/CDM-v1.0%20Compliant-green)](#constrained-decoding-model-cdm-v10)
[![Zero Hallucination](https://img.shields.io/badge/Grammar-Constrained%20Decoding-orange)](#constrained-decoding-model-cdm-v10)

---

## 📖 Overview

**TATA HALO / VehicleGPT** is an on-board automotive AI copilot powered by Small Language Models (SLMs) and a 24/7 Monitored Vehicle Digital Twin (Common Data Model). It connects live to vehicle CAN bus sensors, reverse-engineers anomalies down to specific mechanical components, forecasts vehicle health, and provides real-time emergency roadside assistance dispatch without hallucinations.

```
[ Driver Query + Live CAN Telemetry ]
                 │
                 ▼
┌────────────────────────────────────────────────────────┐
│ Tier 0: Edge CDM Engine (< 1ms)                        │
│ • Deterministic Sensor Cross-Audit & Tolerance Checker │
│ • Component Failure Mode Isolation & Risk Assessment   │
│ • Instant response without waiting for CPU inference   │
└───────────────────────┬────────────────────────────────┘
                        │ (If query requires generative reasoning)
                        ▼
┌────────────────────────────────────────────────────────┐
│ Tier 1: Constrained Decoding Model (Ollama SLM)        │
│ • Token-level JSON schema constraint (RESPONSE_SCHEMA) │
│ • Runs local Qwen 2.5 0.5B / Qwen 3.5 0.8B on device   │
│ • Zero grammar violations, no hallucinated fields      │
└───────────────────────┬────────────────────────────────┘
                        │ (If offline or timeout)
                        ▼
┌────────────────────────────────────────────────────────┐
│ Tier 2: VehicleGPT Python Backend (Port 8765)          │
│ • RAG with Chroma vector store & 1-year telemetry twin │
│ • Predictor engine for fuel, thermal & battery life    │
└────────────────────────────────────────────────────────┘
```

---

## 🛠️ Key Features

- **Master Automotive Reverse-Engineering Engine**: Audits all 6 live domains (Powertrain, Transmission, Thermal, Electrical, Lubrication, TPMS). When an anomaly occurs (e.g. 28.0 psi tyre pressure at 97.4 km/h cruising), it isolates the failing component, calculates sidewall thermal stress and rolling drag, and delivers exact master-mechanic remedies.
- **Constrained Decoding Model (CDM v1.0)**: Employs grammar-constrained token sampling (`format: RESPONSE_SCHEMA`) on local SLMs (`qwen2.5:0.5b`, `qwen3.5:0.8b`). The sampler cannot physically emit invalid JSON keys or free-form prose.
- **24/7 Digital Twin & Causal Failure Reasoning**: Ingests 1-year continuous telemetry, service logs, and DTC events. Accurately traces multi-month failure chains (e.g. aftermarket 0.9 bar radiator cap → highway boiling → head gasket breach → oil dilution → bearing seizure).
- **Interactive 3D Halo Car Experience**: Real-time Three.js 3D Tata Punch vehicle model with live CAN bus replay (Speed, RPM, Coolant, Oil, TPMS, Battery).
- **Live OpenStreetMap Emergency Roadside Assistance (RSA)**: Detects breakdown conditions and dispatches verified Tata Authorized workshops and local mobile mechanics based on real GPS coordinates.

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- **Node.js**: v18.0.0 or higher
- **Python**: v3.10 or higher
- **Ollama**: Installed from [ollama.com](https://ollama.com)

---

### 2. Installation

Clone the repository and install frontend dependencies:
```bash
git clone https://github.com/aravindsmailoff/TATA-HALO.git
cd TATA-HALO
npm install
```

Install Python backend dependencies:
```bash
cd vehiclegpt
pip install -r requirements.txt
cd ..
```

---

### 3. Setting Up Ollama (Edge SLM)

Ensure Ollama is running:
```bash
ollama serve
```

Pull or create the recommended on-device models:
```bash
# Lightweight edge model (397 MB — ultra-fast)
ollama pull qwen2.5:0.5b

# Recommended higher reasoning model (1.3 GB)
ollama pull qwen3.5:0.8b

# Or build the custom VehicleGPT model from Modelfile
ollama create vehiclegpt -f ./vehiclegpt/inference/modelfile/Modelfile
```

---

### 4. Running the Complete Pipeline

Open two terminal windows:

#### Terminal 1 — Start the VehicleGPT Python Backend (Port 8765):
```bash
# Windows Command Prompt
set PYTHONPATH=vehiclegpt&& python -m uvicorn vehiclegpt.api.rest_api:app --host 0.0.0.0 --port 8765

# Linux / macOS
PYTHONPATH=vehiclegpt python -m uvicorn vehiclegpt.api.rest_api:app --host 0.0.0.0 --port 8765
```
- REST API Documentation: [http://localhost:8765/docs](http://localhost:8765/docs)
- Real-time CAN Snapshot: [http://localhost:8765/status](http://localhost:8765/status)

#### Terminal 2 — Start the Next.js Frontend & Edge API (Port 3000):
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## ⚙️ AI Configuration & Tuning

### 1. Model Selection & Sampling Configuration
In [`src/lib/cdm/decoder.js`](src/lib/cdm/decoder.js), you can configure which local model is called, the generation temperature, and context length:
```javascript
export function buildConstrainedPayload(telemetryContext, userQuery, model = 'vehiclegpt') {
  return {
    model,
    prompt: buildPrompt(telemetryContext, userQuery),
    stream: false,
    format: RESPONSE_SCHEMA,          // Enforces schema grammar
    options: {
      temperature: 0.05,              // Near-deterministic diagnostic precision
      num_predict: 200,               // Max tokens
      num_ctx: 1024,                  // Context window
      num_thread: 8,
    },
  };
}
```

### 2. Output Schema Enforcement (CDM)
The output shape is strictly defined in [`src/lib/cdm/schema.js`](src/lib/cdm/schema.js):
```json
{
  "status": "OK | WARNING | CRITICAL | ERROR",
  "answer": "1-3 direct factual sentences using exact live metrics. No greetings.",
  "severity": "NONE | LOW | MEDIUM | HIGH | CRITICAL",
  "active_faults": ["C0077"],
  "metric_value": 28.0,
  "metric_unit": "psi",
  "recommendation": "Top up Rear-Right tyre to 32.0 psi at next fuel station within 10 km."
}
```

### 3. Regenerating / Retraining the Dataset
To generate instruction-tuning dataset pairs for fine-tuning local SLMs (Qwen 0.5B / Llama 1B):
```bash
set PYTHONPATH=vehiclegpt&& python vehiclegpt/training/generate_cdm_training_data.py
```
Outputs:
- `vehiclegpt/data/datasets/training/cdm_vehicle_twin_dataset.jsonl`
- `vehiclegpt/data/datasets/training/cdm_vehicle_twin_dataset.json`

---

## 🔍 Example Diagnostic Queries

| Query | What the AI Reverse-Engineers |
|---|---|
| `"hello is my car running fine ?"` | Audits all 6 live domains. Pinpoints RR tyre at 28.0 psi (-4 psi deficit). Calculates sidewall thermal build-up (+15°C) and blowout risk at 97.4 km/h cruising. |
| `"What component failed or what broke?"` | Identifies Rear-Right tyre pneumatic seal / bead leak. Confirms engine coolant, battery, and oil pressure are nominal. |
| `"Why did my driving range drop over the last 2 weeks?"` | Correlates 42 aggressive high-RPM acceleration events, 95% AC compressor duty cycle, and 28 psi tyre rolling resistance (+4% penalty). |
| `"When did the car break down and what caused it?"` | Dissects historical telemetry: April 30k service radiator cap switch (0.9 bar) → October tap water top-ups → 118.6°C overheat → head gasket breach → oil dilution (110.3%) → rod bearing seizure. |
| `"Car broke down! Call nearest mechanic"` | Queries OpenStreetMap API with driver's live GPS coordinates; returns nearest Tata Authorized Workshop and mobile mechanic with phone numbers and ETA. |

---

## 📂 Project Structure

```
├── datasets/                           # Monitored 1-year telemetry & service datasets
│   ├── daily_telemetry.csv             # Daily sensor summaries across 365 days
│   ├── failure_trip_1hz.csv            # 1 Hz high-resolution breakdown telemetry
│   ├── parts_replaced.csv              # Full component replacement audit trail
│   └── service_history.csv             # Workshop service records
├── src/
│   ├── app/
│   │   ├── api/query/route.js          # Next.js multi-tier diagnostic query router
│   │   └── page.jsx                    # Main application view
│   ├── components/
│   │   └── HaloCarExperience.jsx       # Three.js 3D Tata Punch cockpit & CAN replay
│   └── lib/cdm/
│       ├── schema.js                   # CDM v1.0 JSON schemas & telemetry normalizers
│       └── decoder.js                  # Grammar-constrained Ollama decoder
├── vehiclegpt/
│   ├── api/rest_api.py                 # FastAPI backend (port 8765)
│   ├── cdm/                            # Digital twin reasoner & failure causality
│   ├── rag/pipeline.py                 # RAG orchestrator with Chroma & ring buffer
│   └── training/                       # Instruction-tuning dataset generators
└── tata-punch-3d-model.glb             # Optimized 3D model for Tata Punch
```

---

## 🛡️ License

Developed for the **Tata Motors Vehicle Intelligence Initiative**. All rights reserved.
