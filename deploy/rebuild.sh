#!/usr/bin/env bash
# 服务器上的完整重建：拉 Gitee → 容器构建（含 AI 摘要）→ 发布。
# 约定：这台机器上的 checkout 是「只构建」的，不接受本地改动（会 reset --hard）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BRANCH="${BRANCH:-master}"
REMOTE="${REMOTE:-origin}"

echo "== fetch $REMOTE/$BRANCH =="
git fetch "$REMOTE" "$BRANCH"
git reset --hard "$REMOTE/$BRANCH"

echo "== build in container =="
deploy/build.sh

if [ "${DEPLOY:-wrangler}" = "none" ]; then
  echo "DEPLOY=none，跳过发布（产物在 dist/）"
  exit 0
fi

if command -v wrangler >/dev/null 2>&1; then
  echo "== deploy to Cloudflare Pages =="
  wrangler pages deploy dist \
    --project-name="${CF_PROJECT:-rustembed}" \
    --branch=main
else
  echo "未找到 wrangler；产物已生成在 dist/，请自行同步到 web 根目录或用 CI 发布"
fi
