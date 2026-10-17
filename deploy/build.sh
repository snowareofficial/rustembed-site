#!/usr/bin/env bash
# 在容器里构建当前目录，产物写回 ./dist（需要 Docker）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

IMAGE="${IMAGE:-rec-blog-builder:latest}"

docker build -t "$IMAGE" .

USER_FLAG=()
if command -v id >/dev/null 2>&1; then
  USER_FLAG=(--user "$(id -u):$(id -g)")
fi

docker run --rm "${USER_FLAG[@]}" \
  -v "$ROOT:/src" \
  -e AI_BASE_URL="${AI_BASE_URL:-}" \
  -e AI_API_KEY="${AI_API_KEY:-}" \
  -e AI_MODEL="${AI_MODEL:-glm-4.7-flash}" \
  "$IMAGE"

echo "产物：$ROOT/dist"
