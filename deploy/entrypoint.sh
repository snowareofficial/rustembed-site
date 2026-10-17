#!/bin/sh
# 容器内入口：构建 →（可选）AI 摘要 → 再构建 → 自检。
# 不联网也能跑；AI_* 未设置时自动跳过摘要，用抽取式。
set -eu

echo "== build (1/2) =="
python engine/cli.py build --offline

if [ -n "${AI_BASE_URL:-}" ] && [ -n "${AI_API_KEY:-}" ]; then
  echo "== ai summarize =="
  python engine/ai_summarize.py --write || echo "[warn] AI 摘要失败，继续用抽取式"
  echo "== build (2/2) =="
  python engine/cli.py build --offline
else
  echo "== ai summarize skipped（未设置 AI_BASE_URL / AI_API_KEY）=="
fi

echo "== check =="
python engine/cli.py check

echo "== structure =="
python engine/test_structure.py

echo "== done: /src/dist =="
