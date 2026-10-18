#!/usr/bin/env python3
"""写作台本地 API 服务入口（只用标准库）。

由 Rust 启动器拉起：`python3 engine/gui.py --port 0`，
会话密钥经环境变量 `GUI_TOKEN` 传入（不放 argv，进程列表可见）。
启动成功后打印一行握手：`GUI_PORT=<实际端口>`。

只监听 127.0.0.1；业务全在 `gui_api.py`，本文件只管进程与端口。
"""

import argparse
import os
import sys
from http.server import ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))


def main(argv=None):
    if HERE not in sys.path:
        sys.path.insert(0, HERE)

    ap = argparse.ArgumentParser(description="rec-blog 写作台本地 API")
    ap.add_argument("--port", type=int, default=0, help="监听端口；0 = 让系统分配")
    ap.add_argument("--site", default="", help="站点目录或仓库根（默认 <repo>/site）")
    args = ap.parse_args(argv)

    # engine/config.py 在导入期就决定站点根目录，所以必须先进环境变量再 import
    if args.site:
        os.environ["REC_BLOG_SITE"] = os.path.abspath(args.site)

    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

    from gui_api import make_handler  # 站点路径确定后才能导入

    token = os.environ.get("GUI_TOKEN", "")
    httpd = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(token))
    httpd.gui_token = token
    port = httpd.server_address[1]
    # 握手行：Rust 侧读到这行才知道 Python 监听在哪个端口
    print("GUI_PORT=%d" % port, flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
