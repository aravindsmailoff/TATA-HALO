"""
VehicleGPT — Training Pipeline
Fine-tunes Qwen2.5-0.5B on automotive domain data using Unsloth + LoRA.

====================================================================
 📂  HOW TO FEED YOUR DATASET
====================================================================
Place training files in: ./data/datasets/training/

Supported formats:
  1. JSONL (preferred):
     {"instruction": "...", "input": "...", "output": "..."}

  2. CSV:
     instruction, input, output

  3. HuggingFace Dataset JSON

Example training pair:
  {
    "instruction": "What does this signal reading mean?",
    "input": "ENGINE_COOLANT_TEMP=108 celsius, SOURCE=CAN",
    "output": "{\"status\": \"FAULT\", \"answer\": \"Engine coolant temperature is critically high at 108°C. Stop the vehicle safely and allow the engine to cool.\", \"severity\": \"HIGH\", \"timestamp\": \"\", \"active_faults\": [\"P0217\"], \"data\": 108.0}"
  }

Run training:
  pip install unsloth transformers datasets peft
  python training/finetune.py --dataset-dir ./data/datasets/training
====================================================================
"""
import os
import json
import csv
import logging
import argparse
from pathlib import Path
from typing import List, Dict

logger = logging.getLogger("vehiclegpt.training")


# ── Dataset Loading ──────────────────────────────────────────
def load_dataset_dir(dataset_dir: str) -> List[Dict]:
    """
    Load all training files from dataset_dir.
    Supports: .jsonl, .json, .csv
    """
    dir_path = Path(dataset_dir)
    all_examples = []

    if not dir_path.exists():
        logger.error(f"Dataset dir not found: {dataset_dir}")
        return []

    files = list(dir_path.glob("*.jsonl")) + \
            list(dir_path.glob("*.json")) + \
            list(dir_path.glob("*.csv"))

    if not files:
        logger.warning(
            f"No training files found in {dataset_dir}.\n"
            "Create .jsonl files with format:\n"
            '  {"instruction": "...", "input": "...", "output": "..."}'
        )
        return []

    for f in files:
        ext = f.suffix.lower()
        logger.info(f"Loading: {f.name}")

        try:
            if ext == ".jsonl":
                with open(f) as fp:
                    for line in fp:
                        line = line.strip()
                        if line:
                            all_examples.append(json.loads(line))

            elif ext == ".json":
                with open(f) as fp:
                    data = json.load(fp)
                    if isinstance(data, list):
                        all_examples.extend(data)
                    elif isinstance(data, dict):
                        all_examples.append(data)

            elif ext == ".csv":
                with open(f, newline="") as fp:
                    reader = csv.DictReader(fp)
                    for row in reader:
                        all_examples.append(dict(row))

        except Exception as e:
            logger.error(f"Failed to load {f.name}: {e}")

    logger.info(f"Total training examples loaded: {len(all_examples)}")
    return all_examples


def format_prompt(example: dict) -> str:
    """Format a single training example into Qwen chat template."""
    instruction = example.get("instruction", "").strip()
    inp = example.get("input", "").strip()
    output = example.get("output", "").strip()

    if inp:
        user_msg = f"{instruction}\n\nVEHICLE_CONTEXT:\n{inp}"
    else:
        user_msg = instruction

    return (
        f"<|im_start|>system\n"
        f"You are VehicleGPT, a precise vehicle diagnostics assistant. "
        f"Always respond with valid JSON only.<|im_end|>\n"
        f"<|im_start|>user\n{user_msg}<|im_end|>\n"
        f"<|im_start|>assistant\n{output}<|im_end|>"
    )


def validate_example(example: dict) -> bool:
    """Validate that output is valid JSON matching the schema."""
    output = example.get("output", "")
    if not output:
        return False
    try:
        obj = json.loads(output)
        required = {"status", "answer", "severity"}
        return required.issubset(obj.keys())
    except json.JSONDecodeError:
        return False


# ── Fine-Tuning ──────────────────────────────────────────────
def run_finetuning(dataset_dir: str, output_dir: str, cfg: dict):
    """
    Fine-tune Qwen2.5-0.5B using Unsloth + LoRA.
    Exports to GGUF Q4_K_M for embedded deployment.
    Requires: pip install unsloth transformers datasets peft trl
    """
    try:
        from unsloth import FastLanguageModel
        from trl import SFTTrainer
        from transformers import TrainingArguments
        from datasets import Dataset
    except ImportError as e:
        logger.error(
            f"Missing dependency: {e}\n"
            "Install with: pip install unsloth transformers trl datasets peft"
        )
        return

    # ── Load Data ────────────────────────────────────────────
    raw_examples = load_dataset_dir(dataset_dir)
    if not raw_examples:
        logger.error("No training data found. Aborting.")
        return

    # Filter invalid examples
    valid = [ex for ex in raw_examples if validate_example(ex)]
    invalid_count = len(raw_examples) - len(valid)
    if invalid_count > 0:
        logger.warning(f"Dropped {invalid_count} invalid examples (bad JSON output)")

    if not valid:
        logger.error("No valid training examples after filtering.")
        return

    texts = [format_prompt(ex) for ex in valid]
    dataset = Dataset.from_dict({"text": texts})
    logger.info(f"Training on {len(texts)} examples.")

    # ── Load Model ───────────────────────────────────────────
    max_seq_len = cfg.get("max_seq_length", 512)
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=cfg.get("base_model", "Qwen/Qwen2.5-0.5B-Instruct"),
        max_seq_length=max_seq_len,
        load_in_4bit=True,
        dtype=None,
    )

    # ── Apply LoRA ───────────────────────────────────────────
    model = FastLanguageModel.get_peft_model(
        model,
        r=cfg.get("lora_rank", 16),
        lora_alpha=cfg.get("lora_alpha", 16),
        lora_dropout=0,
        bias="none",
        use_gradient_checkpointing="unsloth",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                         "gate_proj", "up_proj", "down_proj"],
    )

    # ── Train ────────────────────────────────────────────────
    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset,
        dataset_text_field="text",
        max_seq_length=max_seq_len,
        args=TrainingArguments(
            output_dir=output_dir,
            num_train_epochs=cfg.get("num_epochs", 3),
            per_device_train_batch_size=cfg.get("batch_size", 4),
            gradient_accumulation_steps=2,
            learning_rate=cfg.get("learning_rate", 2e-4),
            fp16=True,
            logging_steps=10,
            save_steps=100,
            warmup_ratio=0.1,
            lr_scheduler_type="cosine",
            report_to="none",
            optim="adamw_8bit",
        ),
    )

    logger.info("Starting fine-tuning...")
    trainer.train()

    # ── Export GGUF ──────────────────────────────────────────
    quant = cfg.get("export_quantization", "q4_k_m")
    gguf_path = Path(output_dir) / f"vehiclegpt-{quant}.gguf"
    logger.info(f"Exporting to GGUF ({quant}) → {gguf_path}")

    model.save_pretrained_gguf(
        str(gguf_path.with_suffix("")),
        tokenizer,
        quantization_method=quant,
    )

    logger.info(f"✅ Training complete. Model saved: {gguf_path}")
    logger.info(
        f"\nNext steps:\n"
        f"  1. Copy {gguf_path} to target device\n"
        f"  2. Update config.yaml: gguf_path: {gguf_path}\n"
        f"  3. Or: ollama create vehiclegpt -f ./inference/modelfile/Modelfile\n"
        f"     (after updating FROM line in Modelfile to point to the GGUF)"
    )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")

    parser = argparse.ArgumentParser(description="VehicleGPT Fine-Tuning")
    parser.add_argument(
        "--dataset-dir",
        default="./data/datasets/training",
        help="Directory containing .jsonl/.json/.csv training files",
    )
    parser.add_argument(
        "--output-dir",
        default="./data/models",
        help="Output directory for trained model",
    )
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Only validate the dataset without training",
    )
    args = parser.parse_args()

    examples = load_dataset_dir(args.dataset_dir)

    if args.validate_only:
        valid = [ex for ex in examples if validate_example(ex)]
        print(f"\nDataset Summary:")
        print(f"  Total examples : {len(examples)}")
        print(f"  Valid examples : {len(valid)}")
        print(f"  Invalid        : {len(examples) - len(valid)}")
        if valid:
            print(f"\nSample formatted prompt:")
            print("-" * 60)
            print(format_prompt(valid[0])[:500])
        exit(0)

    # Load config
    try:
        import yaml
        with open("./config/config.yaml") as f:
            cfg = yaml.safe_load(f)
        train_cfg = cfg.get("training", {})
    except Exception:
        train_cfg = {}

    run_finetuning(args.dataset_dir, args.output_dir, train_cfg)
