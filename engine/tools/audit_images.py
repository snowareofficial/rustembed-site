#!/usr/bin/env python3
"""全站图片引用审计：只报告，不改任何文件。

python engine/tools/audit_images.py            # 扫内容 + 主题 + 产物
python engine/tools/audit_images.py --no-dist  # 只扫源码（还没构建时）

查五类问题：
  1. 外链图片      Markdown / HTML / SML / CSS 里的 http(s) 图
  2. 本地引用不存在  文件缺失、大小写不匹配、URL 编码/空格/查询串、../ 越界
  3. 图片没进产物   源码有、dist 里没有
  4. 坏图          0 字节、扩展名与 magic bytes 不符、下载到 HTML 错误页
  5. 孤儿图片      没人引用（只报告，不删）

退出码：有 1–4 类问题返回 1（可当门禁用），只有孤儿图片返回 0。
"""

import argparse
import json
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from engine.core import config  # noqa: E402
from engine.content import imgcheck as ic  # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass

ROOT = config.SITE
CONTENT = config.CONTENT
THEME = config.THEME
DIST = config.OUT

COLS = ("file", "line", "ref", "kind", "advice", "auto")


def _w(s):
    """终端显示宽度：中文与全角符号算两格，表格才对得齐。"""
    return sum(2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in str(s))


def _pad(s, n):
    s = str(s)
    return s + " " * max(1, n - _w(s))


def rows_table(rows):
    if not rows:
        return "  （没有问题）"
    widths = {c: max(_w(c), *(_w(r[c]) for r in rows)) for c in COLS}
    out = ["  " + " | ".join(_pad(c, widths[c]) for c in COLS),
           "  " + "-+-".join("-" * widths[c] for c in COLS)]
    for r in rows:
        out.append("  " + " | ".join(_pad(r[c], widths[c]) for c in COLS))
    return "\n".join(out)


def _rel(p):
    try:
        return Path(p).resolve().relative_to(ROOT.resolve()).as_posix()
    except (ValueError, OSError):
        return str(p)


def _case_insensitive(base, name):
    """目录里找同名不同大小写的文件（Windows/macOS 上「存在」，Linux 上裂图）。"""
    if not base.is_dir():
        return None
    for p in base.iterdir():
        if p.name.lower() == name.lower():
            return p
    return None


def _url_decode_variants(ref):
    """URL 编码 / 空格 / 查询串的候选真身，按「最可能」排序。"""
    from urllib.parse import unquote
    cands = []
    raw = ref.split("?")[0].split("#")[0]
    for v in (ref, raw, unquote(ref), unquote(raw)):
        if v and v not in cands:
            cands.append(v)
    return cands


def resolve_local(base, ref):
    """把正文里的相对引用解析成磁盘路径。

    返回 (path 或 None, 问题标签 或 None, 建议, 可自动修)。
    """
    if ref.startswith("/"):
        return (ROOT / ref.lstrip("/"), None, "", "否") if (ROOT / ref.lstrip("/")).exists() \
            else (None, "缺失", "站内绝对路径没人这么写图片；改成 assets/ 相对路径", "否")
    if ic.is_external(ref):
        return (None, "外链", "下载到本篇 assets/（ASCII 短名）后改相对路径；需作者授权", "否")
    if "../" in ref:
        return (None, "越界", "图片不得逃出所在目录；移到本篇 assets/ 再引用", "否")

    cands = _url_decode_variants(ref)
    # 1) 直接命中
    for c in cands:
        p = base / c
        if p.is_file():
            return (p, None, "", "否")
    # 2) 大小写不匹配（磁盘上找得到，只是大小写不同）
    for c in cands:
        hit = _case_insensitive(base, Path(c).name)
        if hit is not None and hit.name != Path(c).name:
            return (hit, "大小写", "引用与真实文件名大小写不一致，按磁盘上的名字改", "可自动修")
    # 3) 需要 URL 解码 / 去查询串才对上
    for c in cands:
        p = base / c
        if p.exists():
            return (p, "编码/空格", "引用带编码、空格或查询串；文件名改用 ASCII 短名", "可自动修")
    return (None, "缺失", "找不到文件：先在历史分支/提交里找，找不到请作者补图（不要网上随便找）", "否")


def audit_source():
    """扫 site/content 与 site/theme，返回问题行 + 被引用的本地文件集合。"""
    problems, used = [], set()

    def scan(root, label):
        for f in sorted(root.rglob("*")):
            if not f.is_file() or f.suffix.lower() not in (".md", ".sml", ".html", ".css"):
                continue
            try:
                text = f.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                problems.append(dict(file=_rel(f), line=0, ref="", kind="读取失败",
                                     advice="文件不是 UTF-8 或读不出来", auto="否"))
                continue
            for line, ref, origin in ic.text_refs(f.name, text):
                if not ic.is_image_ref(ref) and not ic.is_external(ref):
                    continue          # 只关心图片；普通链接由 urls 白名单管
                if ic.is_external(ref):
                    problems.append(dict(file=_rel(f), line=line, ref=ref, kind="外链",
                                         advice="下载到本篇 assets/（ASCII 短名）后改相对路径；需作者授权",
                                         auto="否"))
                    continue
                if origin == "sml-text":
                    continue          # 文档示例：渲染出来是转义文本，不是真图片
                base = f.parent if f.suffix.lower() in (".md", ".sml") else THEME
                p, kind, advice, auto = resolve_local(base, ref)
                if p is None:
                    problems.append(dict(file=_rel(f), line=line, ref=ref, kind=kind,
                                         advice=advice, auto=auto))
                    continue
                used.add(p.resolve())
                if kind:
                    problems.append(dict(file=_rel(f), line=line, ref=ref, kind=kind,
                                         advice=advice, auto=auto))
                pr = ic.probe(p)
                if pr["zero"]:
                    problems.append(dict(file=_rel(f), line=line, ref=_rel(p), kind="0 字节",
                                         advice="重新提供原图；不要用占位图冒充", auto="否"))
                elif pr["html_page"]:
                    problems.append(dict(file=_rel(f), line=line, ref=_rel(p), kind="HTML 错误页",
                                         advice="文件内容是网页不是图（多半是下载失败的产物）", auto="否"))
                elif pr["bad_magic"]:
                    problems.append(dict(
                        file=_rel(f), line=line, ref=_rel(p), kind="格式不符",
                        advice="扩展名 %s 与内容 %s 不符；用真图替换" % (pr["want"], pr["fmt"]),
                        auto="否"))

    scan(CONTENT, "content")
    scan(THEME, "theme")
    return problems, used


def audit_dist(manifest, used):
    """产物侧：被引用的图必须在 dist 里、非 0 字节、格式没写错。"""
    problems = []
    # 成员头像：manifest 里写的必须是 assets/members/... 本地路径
    for mem in manifest.get("members") or []:
        av = mem.get("avatar") or ""
        if not av:
            continue
        if ic.is_external(av):
            problems.append(dict(file="manifest.json", line=0, ref=av, kind="外链头像",
                                 advice="manifest.avatar 必须是 assets/members/... 本地路径", auto="否"))
            continue
        pr = ic.probe(DIST / av)
        if not pr["exists"]:
            problems.append(dict(file="manifest.json", line=0, ref=av, kind="产物缺失",
                                 advice="源图在但没进产物：重新 build", auto="否"))
        elif pr["zero"]:
            problems.append(dict(file="manifest.json", line=0, ref=av, kind="0 字节",
                                 advice="重新提供头像原图", auto="否"))
        elif pr["bad_magic"]:
            problems.append(dict(file="manifest.json", line=0, ref=av, kind="格式不符",
                                 advice="扩展名 %s 与内容 %s 不符" % (pr["want"], pr["fmt"]), auto="否"))
    # 正文片段里的 <img src>
    for html in sorted((DIST / "p").glob("*.html")) + sorted((DIST / "w").glob("*.html")) \
            + sorted((DIST / "pages").glob("*.html")):
        try:
            text = html.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for line, ref in ic.html_image_refs(text):
            if ic.is_external(ref):
                problems.append(dict(file=_rel(html), line=line, ref=ref, kind="外链",
                                     advice="正文图片不许外链：下载到本篇 assets/ 后改相对路径", auto="否"))
                continue
            pr = ic.probe(DIST / ref)
            if not pr["exists"]:
                problems.append(dict(file=_rel(html), line=line, ref=ref, kind="产物缺失",
                                     advice="源码里引用了但产物里没有（漏提交或构建漏拷贝）", auto="否"))
            elif pr["zero"] or pr["html_page"] or pr["bad_magic"]:
                problems.append(dict(file=_rel(html), line=line, ref=ref,
                                     kind="0 字节" if pr["zero"] else
                                     ("HTML 错误页" if pr["html_page"] else "格式不符"),
                                     advice="产物里的图是坏的，回去修源图", auto="否"))
    return problems


def audit_orphans(used):
    """没人引用的图片文件。只报告，绝不自动删（可能是即将引用的新图）。"""
    orphans = []
    auto_dirs = {CONTENT / "avatars", ROOT}       # 成员头像与群 logo 靠约定自动发现
    for f in sorted(CONTENT.rglob("*")):
        if not f.is_file() or f.suffix.lower() not in ic.IMAGE_EXT:
            continue
        if any(f.parent == d for d in auto_dirs):
            continue
        if f.resolve() not in used:
            orphans.append(dict(file=_rel(f), line=0, ref=f.name, kind="孤儿图片",
                                advice="没有任何内容引用它；确认无用后由人删除", auto="否"))
    return orphans


def main(argv=None):
    ap = argparse.ArgumentParser(description="全站图片引用审计（只报告，不改文件）")
    ap.add_argument("--no-dist", action="store_true", help="只扫源码，不校验 dist")
    ap.add_argument("--with-orphans", action="store_true", help="把孤儿图片也算进退出码")
    args = ap.parse_args(argv)

    print("== 图片引用审计 ==")
    print("-- 站点：%s" % ROOT)
    problems, used = audit_source()

    orphans = audit_orphans(used)
    dist_problems = []
    if not args.no_dist:
        man_path = DIST / "manifest.json"
        if not man_path.exists():
            print("  [warn] %s 不存在，跳过产物侧检查（先跑 python engine/cli.py build）"
                  % _rel(man_path))
        else:
            manifest = json.loads(man_path.read_text(encoding="utf-8"))
            dist_problems = audit_dist(manifest, used)

    hard = problems + dist_problems
    print("-- 源码引用：%d 个问题" % len(problems))
    print(rows_table(problems))
    if dist_problems:
        print("-- 产物引用：%d 个问题" % len(dist_problems))
        print(rows_table(dist_problems))
    print("-- 孤儿图片：%d 个（只报告，不删）" % len(orphans))
    print(rows_table(orphans))

    blocking = hard + (orphans if args.with_orphans else [])
    print("-- 合计：阻断 %d 项（孤儿 %d 项不计入）"
          % (len(blocking), len(orphans)))
    if blocking:
        return 1
    print("IMAGE AUDIT PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
