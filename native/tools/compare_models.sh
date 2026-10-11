#!/bin/zsh
# Runs the three evaluation sets × three decoding modes for every installed model and records
# accuracy, latency and peak memory. Output: ../qa/ai_compare/<model>.txt + summary.
set -uo pipefail
cd "$(dirname "$0")/.."
OUT=../qa/ai_compare
mkdir -p "$OUT"
MODELS=("$@")
[[ ${#MODELS} -eq 0 ]] && MODELS=(${(f)"$(./build/tools/thcad-cli models | sed 's/^[* ] //')"})
for m in "${MODELS[@]}"; do
  name=$(basename "$m" .gguf | sed 's/-00001-of-0000[0-9]//')
  : > "$OUT/$name.txt"
  for set in "" --holdout --holdout-b --holdout-c; do
    echo "### set ${set:-tuning}" >> "$OUT/$name.txt"
    THCAD_MODEL="$m" /usr/bin/time -l ./build/tools/thcad-cli ai-eval $set --compare >> "$OUT/$name.txt" 2> "$OUT/$name.time${set}.txt"
    grep "maximum resident set size" "$OUT/$name.time${set}.txt" >> "$OUT/$name.txt"
  done
  echo "== $name"; grep -E "^(### |hybrid|grammar|free|.*maximum resident)" "$OUT/$name.txt"
done
