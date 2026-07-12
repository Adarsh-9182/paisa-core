#!/bin/zsh
# LoRA fine-tune of the Paisa narrator — YOUR run, not Claude's.
#
# Base model: Qwen2.5-3B-Instruct, 4-bit (≈1.9 GB download, fits 16 GB RAM).
# Data: lab/data/{train,valid}.jsonl (node lab/generate-data.mjs first).
#
# Knobs worth experimenting with (this is the lab):
#   --iters          600 is a starting point; watch valid loss, not vibes
#   --num-layers     how many layers get adapters (more = capacity + memory)
#   --batch-size     drop to 2 if memory pressure hits
#   --learning-rate  1e-5 conservative; try 5e-5 and watch it overfit
set -e
cd "$(dirname "$0")/.."

MODEL="${MODEL:-mlx-community/Qwen2.5-3B-Instruct-4bit}"
ADAPTER="${ADAPTER:-lab/adapters/paisa-narrator-v0}"

lab/.venv/bin/mlx_lm.lora \
  --model "$MODEL" \
  --train \
  --data lab/data \
  --iters "${ITERS:-600}" \
  --batch-size "${BATCH:-4}" \
  --num-layers "${LAYERS:-16}" \
  --learning-rate "${LR:-1e-5}" \
  --steps-per-eval 100 \
  --adapter-path "$ADAPTER"

echo ""
echo "Adapter saved to $ADAPTER. Serve it with:"
echo "  lab/.venv/bin/mlx_lm.server --model $MODEL --adapter-path $ADAPTER --port 8080"
echo "Then grade it with Paisa's own verifier:"
echo "  node lab/eval.mjs"
