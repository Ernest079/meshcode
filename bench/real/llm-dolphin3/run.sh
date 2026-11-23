#!/bin/sh
# One-shot imitations by a small local model (Ollama dolphin3, 8B, CPU) from a text description only:
# meshcode generate (run → repair ≤ 3), then the same model-level comparison as the hand-written imitations.
cd "$(dirname "$0")/../../.."
for p in crate barrel drone; do
  desc=$(node -e "console.log(require('./bench/real/llm-dolphin3/prompts.json')['$p'])")
  start=$(date +%s)
  pnpm -s meshcode generate "$desc" --model dolphin3 -o "bench/real/llm-dolphin3/$p.js" > "bench/real/llm-dolphin3/$p.log" 2>&1
  echo "exit $? seconds $(( $(date +%s) - start ))" >> "bench/real/llm-dolphin3/$p.log"
done
