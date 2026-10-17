#!/usr/bin/env bash
# 字体加密包：MiSans 源字体压缩后用 AES-256 加密，密码只存在 CI secret / 服务器环境里。
#
#   加密（本地，一次性）：FONT_PASSWORD='...' bash deploy/fonts-crypt.sh encrypt
#   解密（CI / 服务器）：  FONT_PASSWORD='...' bash deploy/fonts-crypt.sh decrypt
#
# 产物：site/fonts/misans-fonts.tar.gz.enc（入库；没有密码解不开，不能直接当字体用）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${SRC:-$ROOT/site/fonts/src}"
ENC="${ENC:-$ROOT/site/fonts/misans-fonts.tar.gz.enc}"

if [ -z "${FONT_PASSWORD:-}" ]; then
  echo "缺少 FONT_PASSWORD 环境变量" >&2
  exit 2
fi

case "${1:-}" in
  encrypt)
    [ -d "$SRC" ] || { echo "找不到源字体目录：$SRC" >&2; exit 2; }
    tar -czf - -C "$SRC" . \
      | openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:FONT_PASSWORD -out "$ENC"
    echo "已加密：$ENC（$(du -h "$ENC" | cut -f1)）"
    ;;
  decrypt)
    [ -f "$ENC" ] || { echo "找不到加密包：$ENC" >&2; exit 2; }
    mkdir -p "$SRC"
    openssl enc -d -aes-256-cbc -pbkdf2 -pass env:FONT_PASSWORD -in "$ENC" \
      | tar -xzf - -C "$SRC"
    echo "已解密到：$SRC"
    ls -1 "$SRC"
    ;;
  *)
    echo "用法：FONT_PASSWORD=... $0 encrypt|decrypt" >&2
    exit 2
    ;;
esac
