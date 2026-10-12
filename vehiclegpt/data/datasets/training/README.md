# 📂 Dataset Feed Location

Drop your training files in this directory.
VehicleGPT will automatically discover and load them.

## Supported Formats
- *.jsonl — JSON Lines (one example per line)
- *.json  — JSON array of examples
- *.csv   — CSV with headers: instruction, input, output

## Required Output Schema
Every training example's "output" field MUST be valid JSON:
{
  "status":        "OK | WARNING | FAULT | CRITICAL | NOT_FOUND",
  "answer":        "Plain English explanation",
  "severity":      "NONE | LOW | MEDIUM | HIGH | CRITICAL",
  "timestamp":     "ISO8601 string or empty",
  "active_faults": ["P0217"],
  "data":          123.4
}

## Validate before training
python training/finetune.py --validate-only
