#!/usr/bin/env python3
"""构建器路径与硬编码表：站点定位、产物目录守卫、必填字段表（2026-10-21 自 build.py 拆出）。

路径全部来自 config（--site / REC_BLOG_SITE 的落点）；guard_out / clean_out 一字
未动地从 build.py 搬来 —— 它拒绝的正是「会把源码删掉」的 --out。
"""

import shutil
from pathlib import Path

import config

DOC_EXT = (".sml", ".md", ".markdown")

ROOT = config.SITE                   # 站点根（内容 + 主题 + 元数据缓存）
CONTENT = config.CONTENT             # 人写的内容都在这
THEME = config.THEME                 # 前端壳（静态资源）
OUT = config.OUT                     # 构建产物（仓库根 dist/）
CACHE = config.CACHE                 # 仓库元数据缓存

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}
MAX_IMAGE = 2 * 1024 * 1024
MAX_IMAGES_PER_POST = 20

REQ = {
    "post": ["title", "author", "date", "tags", "summary"],
    "project": ["name", "one_liner", "repo", "status"],
    "member": ["name"],
    "resource": ["title", "kind", "url"],
    "weekly": ["period", "title"],
    "service": ["name", "owner", "skills", "contact", "status", "updated"],
    "doc": ["title"],
    "site": ["title"],
}


def clean_out(out):
    """清空产物目录（仅供外部/调试用；常规构建走 Out.flush 的孤儿清理，
    不在热构建里全删全写 —— 见 Out 的说明）。"""
    if not out.exists():
        out.mkdir(parents=True)
        return
    for p in sorted(out.rglob("*"), key=lambda x: len(str(x)), reverse=True):
        try:
            if p.is_file() or p.is_symlink():
                p.unlink()
            elif p.is_dir():
                p.rmdir()
        except OSError:
            pass


def _under(parent, child):
    """child 是否等于 parent，或位于 parent 之下（两侧都会 resolve）。"""
    a = str(Path(parent).resolve()).rstrip("\\/")
    b = str(Path(child).resolve()).rstrip("\\/")
    if b == a:
        return True
    return any(b.startswith(a + s) for s in ("/", "\\"))


def guard_out(out):
    """拒绝把产物目录指到会毁掉源码的位置 —— clean_out() 会递归清空目标目录。

    放行：仓库外的目录；仓库内的 <repo>/dist 及其子目录。
    拒绝：仓库根、站点目录，以及它们的**上级**（--out . 或 --out 上级目录
          会连整个工作区一起删）；仓库内除 dist/ 外的任何位置（如 --out engine）。
    """
    out = Path(out).resolve()
    repo = Path(config.REPO).resolve()
    site = Path(config.SITE).resolve()
    dist = Path(config.OUT).resolve()
    for label, p in (("仓库根", repo), ("站点目录", site)):
        if _under(out, p):
            raise SystemExit(
                "[E-OUT-001] --out 指向%s（%s）或其上级：%s\n"
                "           构建会先递归清空该目录，请改用仓库外的目录。" % (label, p, out))
    if _under(repo, out) and not _under(dist, out):
        raise SystemExit(
            "[E-OUT-002] --out 落在仓库内但不是 dist/ 之下：%s\n"
            "           构建会先递归清空该目录（源码会丢），请改到仓库外或 %s 之下。"
            % (out, dist))
    return out
