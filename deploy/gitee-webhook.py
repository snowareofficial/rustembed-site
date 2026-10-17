#!/usr/bin/env python3
"""Gitee Webhook → 触发容器重建 / 发布。

用法（服务器上，systemd 托管）：
    GITEE_WEBHOOK_TOKEN=xxx python3 deploy/gitee-webhook.py
环境变量：
    PORT                 默认 8787（建议只监听 127.0.0.1，前面挂 Caddy/nginx）
    GITEE_WEBHOOK_TOKEN  Gitee 仓库 Webhook 里填的「密码」，为空则不校验（不推荐）
    BRANCH               只接受该分支，默认 master
    DEPLOY               wrangler（默认）或 none
    AI_BASE_URL/AI_API_KEY/AI_MODEL  透传给构建（生成 AI 摘要）

接口：
    GET  /healthz        -> {"ok":true,"building":false}
    POST /webhook        -> 校验通过后异步触发 deploy/rebuild.sh，立即 202
"""
import hmac
import json
import os
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOKEN = os.environ.get("GITEE_WEBHOOK_TOKEN", "")
BRANCH = os.environ.get("BRANCH", "master")
PORT = int(os.environ.get("PORT", "8787"))

_lock = threading.Lock()
_state = {"building": False, "last": None}


def run_rebuild():
    with _lock:
        _state["building"] = True
        try:
            env = dict(os.environ)
            proc = subprocess.run(
                ["bash", str(ROOT / "deploy" / "rebuild.sh")],
                cwd=str(ROOT), env=env, capture_output=True, text=True,
            )
            _state["last"] = {
                "code": proc.returncode,
                "tail": ((proc.stdout or "") + (proc.stderr or ""))[-4000:],
            }
            print("[webhook] rebuild rc=%s" % proc.returncode, flush=True)
            print(proc.stdout[-2000:], flush=True)
            print(proc.stderr[-2000:], flush=True)
        except Exception as e:  # noqa: BLE001
            _state["last"] = {"code": -1, "tail": str(e)}
            print("[webhook] rebuild error: %s" % e, flush=True)
        finally:
            _state["building"] = False


class Handler(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/healthz":
            return self._json(200, {"ok": True, "building": _state["building"],
                                    "last": _state["last"]})
        return self._json(404, {"ok": False})

    def do_POST(self):
        if self.path != "/webhook":
            return self._json(404, {"ok": False})
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n else b""
        if TOKEN:
            got = self.headers.get("X-Gitee-Token") or ""
            if not hmac.compare_digest(got, TOKEN):
                return self._json(403, {"ok": False, "error": "bad token"})
        try:
            payload = json.loads(body or b"{}")
        except ValueError:
            payload = {}
        ref = str(payload.get("ref") or "")
        if ref and not ref.endswith("/" + BRANCH):
            return self._json(200, {"ok": True, "skipped": "ref " + ref})
        if _state["building"]:
            return self._json(202, {"ok": True, "queued": False, "building": True})
        threading.Thread(target=run_rebuild, daemon=True).start()
        return self._json(202, {"ok": True, "queued": True})

    def log_message(self, fmt, *args):
        print("[webhook] " + fmt % args, flush=True)


if __name__ == "__main__":
    print("[webhook] listening on 127.0.0.1:%d (branch=%s)" % (PORT, BRANCH), flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
