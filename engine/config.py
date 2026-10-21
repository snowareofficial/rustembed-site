"""站点定位与路径约定。

`engine/` 是可复用的工具体系：它**不认识具体内容**，只依赖下面这套目录约定。
把 engine/ 复制到另一个站点、或把站点换到别的目录，都只需满足约定即可。

站点根目录（默认 <repo>/site，可用 --site 或环境变量 REC_BLOG_SITE 覆盖）下：
    content/{site.sml, posts/, pages/, members/, projects/, resources/, weekly/, topics/, contracts/}
    theme/{index.html, css/, js/}     （多文件；加载顺序以 index.html 的 link/script 序为准）
    meta/repos.json          仓库元数据缓存（入库）
    *.jpg                    群头像（group.jpg 优先，否则取第一个）
产物固定输出到 <repo>/dist/（站点源码保持干净，便于整体复制）。
"""

import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


def _pick_site():
    argv = sys.argv[1:]
    if "--site" in argv:
        i = argv.index("--site")
        if i + 1 < len(argv):
            return Path(argv[i + 1]).resolve()
    env = os.environ.get("REC_BLOG_SITE")
    if env:
        return Path(env).resolve()
    cand = REPO / "site"
    if (cand / "content").is_dir():
        return cand
    if (REPO / "content").is_dir():      # 兼容「站点即仓库根」的布局
        return REPO
    return cand


SITE = _pick_site()
CONTENT = SITE / "content"
THEME = SITE / "theme"
META = SITE / "meta"
OUT = REPO / "dist"
CACHE = META / "repos.json"


def add_site_arg(parser):
    """让 CLI 帮助里出现 --site（实际取值在导入期从 sys.argv 读取）。"""
    parser.add_argument("--site", default="", help="站点根目录（默认 <repo>/site）")
