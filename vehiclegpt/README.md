# VehicleGPT 🚗

**On-Device Natural Language Vehicle Intelligence System**  
Runs fully offline on 2 GB RAM · ARM A55 · ~1.3s response · Zero hallucination via GBNF grammar masking

---

## 📂 How to Feed Your Dataset

> Drop your training files here: **`data/datasets/training/`**

### Supported Formats

**1. JSONL (recommended)**
```json
{"instruction": "What does this mean?", "input": "ENGINE_COOLANT_TEMP=108 celsius", "output": "{\"status\": \"FAULT\", \"answer\": \"Engine overheating.\", \"severity\": \"HIGH\", \"timestamp\": \"\", \"active_faults\": [\"P0217\"], \"data\": 108.0}"}
```

**2. JSON Array**
```json
[
  {"instruction": "...", "input": "...", "output": "..."}
]
```

**3. CSV**
```
instruction, input, output
"What is RPM?", "ENGINE_RPM=820", "{\"status\":\"OK\",...}"
```

### Output Schema (must be valid JSON):
```json
{
  "status":       "OK | WARNING | FAULT | CRITICAL | NOT_FOUND",
  "answer":       "Plain English explanation (max 2 sentences)",
  "severity":     "NONE | LOW | MEDIUM | HIGH | CRITICAL",
  "timestamp":    "ISO8601 or empty string",
  "active_faults": ["P0217", "B1234"],
  "data":         123.4
}
```

See `data/datasets/training/sample_training_data.json` for 10 ready-to-use examples.

---

## 🚀 Quick Start

### 1. Install dependencies
```bash
cd vehiclegpt
pip install -r requirements.txt
```

### 2. Setup Ollama model
```bash
# Install Ollama from https://ollama.com
ollama create vehiclegpt -f ./inference/modelfile/Modelfile
```

### 3. Generate sample data & start
```bash
python simulation/replay_logs.py --generate-sample
python main.py
```

Open: **http://localhost:8765/hmi/index.html**  
API docs: **http://localhost:8765/docs**

---

## 🏋️ Fine-Tuning (on GPU machine)

```bash
# Validate your dataset first
python training/finetune.py --validate-only

# Run fine-tuning (requires NVIDIA GPU, run on Colab/Kaggle)
pip install unsloth transformers trl datasets peft
python training/finetune.py --dataset-dir ./data/datasets/training

# After training: copy GGUF to device and update Modelfile FROM line
# Then: ollama create vehiclegpt -f ./inference/modelfile/Modelfile
```

---

## 📡 API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/query` | Natural language query |
| `GET`  | `/status` | Live signal snapshot |
| `GET`  | `/faults?days=7` | Recent fault codes |
| `GET`  | `/history?q=...` | Semantic search |
| `POST` | `/feed-signal` | **Manual signal injection** |
| `POST` | `/inject-fault` | Test scenario injection |
| `GET`  | `/health` | System health |
| `GET`  | `/docs` | Swagger UI |

### Feed a Signal Manually
```bash
curl -X POST http://localhost:8765/feed-signal \
  -H "Content-Type: application/json" \
  -d '{"signal_id": "ENGINE_COOLANT_TEMP", "value": 108.5, "unit": "celsius"}'
```

---

## 📁 Project Structure
```
vehiclegpt/
├── config/config.yaml          ← Master config
├── data/
│   ├── datasets/
│   │   ├── training/           ← 📂 PUT YOUR DATASETS HERE
│   │   └── raw/                ← DBC files, CSV logs, MF4 files
│   ├── models/                 ← Fine-tuned GGUF models
│   └── db/                     ← SQLite + FAISS index
├── ingestion/
│   ├── can_gateway.py          ← CAN/CAN-FD ingestion
│   └── normalizer.py           ← Signal normalizer
├── storage/
│   ├── timeseries_db.py        ← SQLite 4-week rolling store
│   └── vector_store.py         ← FAISS semantic search
├── rag/pipeline.py             ← RAG orchestrator
├── inference/
│   ├── llm_engine.py           ← Ollama/llama.cpp wrapper
│   ├── grammar/vehicle_response.gbnf ← Constrained decoding
│   └── modelfile/Modelfile     ← Ollama model config
├── api/rest_api.py             ← FastAPI REST server
├── hmi/index.html              ← Web dashboard
├── training/finetune.py        ← Fine-tuning pipeline
├── simulation/replay_logs.py   ← Log replayer + fault injector
└── main.py                     ← Entry point
```

---

## RAM Budget (2 GB System)
| Component | RAM |
|-----------|-----|
| Linux OS (minimal) | 180 MB |
| VehicleGPT daemons | 80 MB |
| Embedding model | 22 MB |
| FAISS index | 30 MB |
| Qwen2.5-0.5B Q4_K_M | **380 MB** |
| llama.cpp + KV cache | 45 MB |
| FastAPI server | 60 MB |
| **Total** | **~797 MB** ✅ |
