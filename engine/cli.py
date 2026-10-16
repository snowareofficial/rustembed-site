#!/usr/bin/env python3
"""rec-blog 命令行（engine 侧）。

    python engine/cli.py new "probe-rs 上手" --tags rust,embedded --author sal
    python engine/cli.py list --tag rust
    python engine/cli.py contracts      # 终端里看契约字段表（代码即文档）
    python engine/cli.py build | check | test | preview

加 --site <目录> 可操作别的站点（engine 与内容分离，便于复用）。
"""

import argparse
import datetime as dt
import re
import subprocess
import sys
from pathlib import Path
import struct

ENGINE = Path(__file__).resolve().parent
sys.path.insert(0, str(ENGINE))
sys.path.insert(0, str(ENGINE / "lib"))

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass

import config  # noqa: E402
import markdown as mdmod  # noqa: E402
import sml  # noqa: E402
import contract as contract_mod  # noqa: E402

MD_TMPL = """---
title: "{title}"
author: {author}
date: {date}
tags: [{tags}]
summary: "一句话摘要（列表页与分享卡片用）"
{extra}---

## 第一个小节

正文。支持 **粗体**、`行内代码`、表格、引用、代码块、图片（`assets/` 下）。

```rust
fn main() {{ }}
```
"""

SML_TMPL = """title: "{title}"
author: {author}
date: {date}
tags: [{tags}]
summary: "一句话摘要（列表页与分享卡片用）"
{extra}
body: [
  topic 第一个小节 {{
    children: [
      para {{ text: "正文。多行文本可以直接换行写，不需要转义。" }}
      code {{ lang: rust text: "fn main() {{ }}" }}
    ]
  }}
]
"""

# SML 场景骨架（与 MD 侧一一对应；字面花括号用 {{ }} 转义，{period} 是占位符）
SML_TUTORIAL_TMPL = """title: "{title}"
author: {author}
date: {date}
tags: [{tags}]
summary: "一句话摘要（列表页与分享卡片用）"
{extra}
body: [
  topic 第一个小节 {{
    children: [
      para {{ text: "正文。" }}
      steps {{
        items: [
          para {{ text: "第一步" }}
          para {{ text: "第二步" }}
        ]
      }}
      term {{ text: "$ echo hello" }}
    ]
  }}
]
"""

SML_PHOTO_TMPL = """title: "{title}"
author: {author}
date: {date}
tags: [{tags}]
summary: "一句话摘要（列表页与分享卡片用）"
{extra}
body: [
  topic 第一个小节 {{
    children: [
      para {{ text: "正文。" }}
      shot {{ src: "assets/photo.png" alt: "图" full: true }}
      gallery {{ cols: 2 items: [
        img {{ src: "assets/1.png" alt: "图1" }}
        img {{ src: "assets/2.png" alt: "图2" }}
      ] }}
    ]
  }}
]
"""

SML_WEEKLY_TMPL = """title: "{title}"
author: {author}
date: {date}
tags: [{tags}]
summary: "本期周报"
{extra}
body: [
  topic 第一个小节 {{
    children: [
      para {{ text: "正文。" }}
      when {{ date: "{period}" text: "本期周报" }}
    ]
  }}
]
"""

TOPIC_TMPL = """---
title: "{title}"
summary: "一句话定义（词条页与知识页用）"
tags: [{tags}]
{extra}---

## 定义

写清楚这个主题到底是什么、边界在哪里。

## 要点

- 要点一
- 要点二
"""


def slugify(title, fallback=""):
    s = re.sub(r"[^a-zA-Z0-9]+", "-", title).strip("-").lower()
    return s or fallback


# JPEG 里携带尺寸信息的帧头标记（非差分 Huffman/算术编码的 SOF）
_JPEG_SOF = frozenset(
    (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB))
_JPEG_STANDALONE = frozenset(
    (0xD0, 0xD1, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0x01))


def _read_image_size(path):
    """读取图片真实尺寸（PNG/JPEG/WebP 头部即可，纯 stdlib，不依赖 Pillow）。

    返回: (width, height) 或 (None, None)。任何解析异常都返回 (None, None)，
    调用方必须容忍（不写尺寸、不抛异常）。
    """
    try:
        with open(path, "rb") as f:
            header = f.read(12)
            if len(header) < 12:
                return None, None

            # PNG: \x89PNG\r\n\x1a\n + IHDR(宽 4 字节大端 @16, 高 4 字节大端 @20)
            if header[:8] == b"\x89PNG\r\n\x1a\n":
                f.seek(16)
                wh = f.read(8)
                if len(wh) < 8:
                    return None, None
                width = struct.unpack(">I", wh[0:4])[0]
                height = struct.unpack(">I", wh[4:8])[0]
                return width, height

            # JPEG: \xff\xd8 起手，逐个扫描段，遇到 SOF 取 高/宽（各 2 字节大端）
            if header[:2] == b"\xff\xd8":
                f.seek(2)
                while True:
                    b = f.read(1)
                    if not b or b != b"\xff":
                        break
                    marker = f.read(1)
                    if not marker:
                        break
                    m = marker[0]
                    if m in _JPEG_STANDALONE:
                        continue
                    size = f.read(2)
                    if len(size) < 2:
                        break
                    seg_len = struct.unpack(">H", size)[0]
                    if m in _JPEG_SOF:
                        data = f.read(5)
                        if len(data) < 5:
                            break
                        height = struct.unpack(">H", data[1:3])[0]
                        width = struct.unpack(">H", data[3:5])[0]
                        return width, height
                    # 跳过本段剩余字节（seg_len 已含 2 字节长度自身）
                    f.seek(seg_len - 2, 1)
                return None, None

            # WebP: RIFF....WEBP + 子块 VP8 / VP8L / VP8X
            if header[:4] == b"RIFF" and header[8:12] == b"WEBP":
                fourcc = f.read(4)
                if len(fourcc) < 4:
                    return None, None
                _size = f.read(4)
                if len(_size) < 4:
                    return None, None
                if fourcc == b"VP8 ":
                    # VP8 关键帧：字节 3-5 起始码 0x9d 0x01 0x2a，之后 宽-1/高-1 各 14 位
                    data = f.read(10)
                    if len(data) < 10:
                        return None, None
                    if data[0:3] == b"\x9d\x01\x2a":
                        width = ((data[6] | (data[7] << 8)) & 0x3FFF) + 1
                        height = ((data[8] | (data[9] << 8)) & 0x3FFF) + 1
                        return width, height
                elif fourcc == b"VP8L":
                    # VP8L：1 字节签名 0x2f，随后 14 位宽-1、14 位高-1（小端）
                    data = f.read(5)
                    if len(data) < 5:
                        return None, None
                    if data[0] == 0x2F:
                        bits = int.from_bytes(data[1:5], "little")
                        width = (bits & 0x3FFF) + 1
                        height = ((bits >> 14) & 0x3FFF) + 1
                        return width, height
                elif fourcc == b"VP8X":
                    # VP8X：1 字节标志 + 3 字节保留，随后 24 位宽-1 / 24 位高-1
                    data = f.read(10)
                    if len(data) < 10:
                        return None, None
                    width = int.from_bytes(data[4:7], "little") + 1
                    height = int.from_bytes(data[7:10], "little") + 1
                    return width, height
                return None, None
    except Exception:
        return None, None
    return None, None


def _site_arg(args):
    return ["--site", args.site] if getattr(args, "site", "") else []


def cmd_new(args):
    slug = args.slug or slugify(args.title)
    if not slug:
        # 标题没有可作目录名的 ASCII 字符时，回退到基于日期的 slug，保证命令可用
        # （仍建议显式 --slug 以获得稳定、可读的目录名）
        slug = "post-%s" % dt.date.today().isoformat()
    tags = " ".join(args.tags.split(",")) if args.tags else "rust"
    if args.topic:
        path = config.CONTENT / "topics" / (slug + ".md")
        extra = "related: []\n"
        tmpl = TOPIC_TMPL
    else:
        year = str(dt.date.today().year)
        path = config.CONTENT / "posts" / year / slug / ("index." + ("sml" if args.sml else "md"))
        extra = ""
        if args.series:
            extra = "series:\n  id: %s\n  title: %s\n  order: 1\n" % (args.series, args.series)
        tmpl = SML_TMPL if args.sml else MD_TMPL
    if path.exists():
        print("已存在：%s" % path)
        return 1
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(tmpl.format(title=args.title, author=args.author, date=dt.date.today().isoformat(),
                                tags=tags, extra=extra), encoding="utf-8")
    print("已创建 %s" % path.relative_to(config.SITE))
    print("写完跑：python engine/cli.py build && python engine/cli.py preview --no-build")
    return 0


def cmd_list(args):
    rows = []
    for f in sorted((config.CONTENT / "posts").glob("*/*/index.*")):
        if f.suffix.lower() not in (".md", ".markdown", ".sml"):
            continue
        d, _ = (sml.load_doc(f) if f.suffix.lower() == ".sml"
                else mdmod.split_front_matter(f.read_text(encoding="utf-8")))
        tags = d.get("tags") or []
        if args.tag and args.tag not in tags:
            continue
        if args.year and f.parent.parent.name != args.year:
            continue
        rows.append((str(d.get("date", "")), f.parent.name, str(d.get("title", "")),
                     " ".join(tags), str(d.get("author", ""))))
    rows.sort(reverse=True)
    if not rows:
        print("没有匹配的文章。")
        return 0
    for date, slug, title, tags, author in rows:
        print("%-12s %-22s %-40s %-20s %s" % (date, slug, title[:38], tags[:18], author))
    print("\n共 %d 篇" % len(rows))
    return 0


def cmd_assets(args):
    post_dir = Path(args.post_dir)
    if not post_dir.exists():
        print("错误：文章目录不存在：%s" % post_dir)
        return 1

    assets_dir = post_dir / "assets"
    if not assets_dir.exists():
        print("警告：assets/ 目录不存在，将输出空内容")
        images = []
    else:
        images = sorted(assets_dir.glob("*"))
        # 过滤图片类型
        valid_ext = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg")
        images = [img for img in images if img.suffix.lower() in valid_ext]

    if not images:
        print("assets/ 目录为空或没有支持的图片格式")
        return 0

    # 校验图片数量
    if len(images) > 20:
        print("警告：图片数量超过 20 张，可能超限")

    style = args.style or "md"
    out_lines = []

    # 判断是否生成图集
    if len(images) > 1:
        # 检查尺寸是否接近
        sizes = []
        for img in images:
            width, height = _read_image_size(img)
            if width and height:
                sizes.append((width, height))
            else:
                sizes.append((0, 0))

        if sizes:
            avg_width = sum(w for w, h in sizes) / len(sizes)
            avg_height = sum(h for w, h in sizes) / len(sizes)
            ratio_var = max(abs((w / h) - (avg_width / avg_height)) for w, h in sizes)
            if ratio_var < 0.1:  # 比例差 < 10%
                # 生成图集
                cols = args.ratio.split(":")[0] if args.ratio else "2"
                out_lines.append(":::gallery %s\n" % cols)
                for i, img in enumerate(images, 1):
                    alt = "图 %d" % i
                    caption = ""
                    if style == "sml":
                        out_lines.append('para { text: "[%s]" }' % img.name)
                    else:
                        out_lines.append("![%s](%s)" % (alt, img.name))
                out_lines.append(":::\n")
                # 输出
                if args.write:
                    with open(args.write, "a", encoding="utf-8") as f:
                        f.write("\n".join(out_lines))
                    print("已追加 %d 个图块到 %s" % (len(images), args.write))
                else:
                    print("\n".join(out_lines))
                return 0

    # 单张图片生成 shot 块
    for img in images:
        width, height = _read_image_size(img)
        is_full = False
        if width and height:
            ratio = width / height
            if width >= 1600 or ratio >= 1.8:
                is_full = True

        if style == "sml":
            if is_full:
                out_lines.append('shot { src: "%s" alt: "图" full: true }\n' % img.name)
            else:
                out_lines.append('shot { src: "%s" alt: "图" }\n' % img.name)
        else:
            if is_full:
                out_lines.append(":::shot\n![图](%s)\n:::\n" % img.name)
            else:
                out_lines.append(":::shot\n![图](%s)\n:::\n" % img.name)

    # 输出
    if args.write:
        with open(args.write, "a", encoding="utf-8") as f:
            f.write("\n".join(out_lines))
        print("已追加 %d 个图块到 %s" % (len(images), args.write))
    else:
        print("\n".join(out_lines))
    return 0


def cmd_gen(args):
    if args.kind not in ("post", "tutorial", "photo", "weekly"):
        print("错误：kind 必须是 post/tutorial/photo/weekly 之一")
        return 1

    today = dt.date.today()
    date = today.isoformat()
    period = "%d-W%d" % (today.year, today.isocalendar()[1])
    title = args.title or "未命名"
    author = args.author
    tags = args.tags or "rust"
    style = args.style or "md"

    # 选模板：MD 侧用字符串替换注入场景块；SML 侧用对应专用模板
    if style == "sml":
        extra = ""
        if args.kind == "post":
            tmpl = SML_TMPL
        elif args.kind == "tutorial":
            tmpl = SML_TUTORIAL_TMPL
        elif args.kind == "photo":
            tmpl = SML_PHOTO_TMPL
        else:  # weekly
            tmpl = SML_WEEKLY_TMPL
    else:
        extra = ""
        if args.kind == "post":
            tmpl = MD_TMPL
        elif args.kind == "tutorial":
            tmpl = MD_TMPL.replace(
                "## 第一个小节",
                "## 第一个小节\n\n:::steps\n- 第一步\n- 第二步\n:::\n\n:::term\n$ echo hello\n:::"
            )
        elif args.kind == "photo":
            tmpl = MD_TMPL.replace(
                "## 第一个小节",
                "## 第一个小节\n\n:::shot full\n![图](assets/photo.png)\n:::\n\n:::gallery 2\n![1](assets/1.png)\n![2](assets/2.png)\n:::"
            )
        else:  # weekly
            tmpl = MD_TMPL.replace(
                "## 第一个小节",
                "## 第一个小节\n\n:::when %s\n本期周报\n:::" % period
            ).replace('summary: "一句话摘要（列表页与分享卡片用）"', 'summary: "本期周报"')

    if args.dry_run:
        if style == "sml":
            print(tmpl.format(title=title, author=author, date=date, tags=tags,
                              extra=extra, period=period))
        else:
            print(tmpl.format(title=title, author=author, date=date, tags=tags, extra=extra))
        return 0

    # 落盘模式
    slug = args.slug or slugify(args.title)
    if not slug:
        print("标题里没有可用作目录名的英文字符，请加 --slug")
        return 2

    year = str(today.year)
    path = config.CONTENT / "posts" / year / slug / "index." + ("sml" if style == "sml" else "md")
    if path.exists():
        print("已存在，拒绝覆盖：%s（请换 --slug 或先删除该目录）" % path.relative_to(config.SITE))
        return 1

    path.parent.mkdir(parents=True, exist_ok=True)
    if style == "sml":
        content = tmpl.format(title=title, author=author, date=date, tags=tags,
                              extra=extra, period=period)
    else:
        content = tmpl.format(title=title, author=author, date=date, tags=tags, extra=extra)
    path.write_text(content, encoding="utf-8")
    print("已创建 %s" % path.relative_to(config.SITE))
    return 0


def cmd_contracts(args):
    reg = {}
    for f in sorted((config.CONTENT / "contracts").glob("*.sml")):
        _, cs = sml.load_doc(f)
        reg.update(cs)
    if not reg:
        print("没有契约（%s 是空的）。" % (config.CONTENT / "contracts").relative_to(config.REPO))
        return 1
    for c in contract_mod.describe(reg):
        print("\n%s%s" % (c["name"], "（loose）" if c["loose"] else ""))
        for f in c["fields"]:
            print("  %-16s %-12s %-4s %-22s %s"
                  % (f["name"], f["type"], "必填" if f["required"] else "可选",
                     f["constraint"], f["doc"]))
    return 0


def run(*cmd):
    return subprocess.call([sys.executable] + list(cmd), cwd=str(config.REPO))


def cmd_build(args):
    extra = ["--offline"] if args.offline else []
    if args.contract_loose:
        extra.append("--contract-loose")
    return run(str(ENGINE / "build.py"), *_site_arg(args), *extra)


def main():
    ap = argparse.ArgumentParser(prog="rec-blog", description="群博客命令行（engine）")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("new", help="新建文章/词条骨架")
    p.add_argument("title")
    p.add_argument("--slug", default="")
    p.add_argument("--tags", default="rust")
    p.add_argument("--author", default="sal")
    p.add_argument("--series", default="")
    p.add_argument("--sml", action="store_true", help="生成 SML 版本而不是 Markdown")
    p.add_argument("--topic", action="store_true", help="创建主题词条（content/topics/）")
    config.add_site_arg(p)
    p.set_defaults(func=cmd_new)

    p = sub.add_parser("list", help="列出文章")
    p.add_argument("--tag", default="")
    p.add_argument("--year", default="")
    config.add_site_arg(p)
    p.set_defaults(func=cmd_list)

    p = sub.add_parser("assets", help="生成图片块的 Markdown/SML 代码")
    p.add_argument("post_dir", help="文章目录路径")
    p.add_argument("--ratio", default="2", help="图集列数（格式如 2）")
    p.add_argument("--style", choices=["md", "sml"], default="md", help="输出格式")
    p.add_argument("--write", help="追加到指定文件")
    config.add_site_arg(p)
    p.set_defaults(func=cmd_assets)

    p = sub.add_parser("gen", help="生成带场景样例的骨架")
    p.add_argument("--kind", choices=["post", "tutorial", "photo", "weekly"], required=True,
                   help="骨架类型")
    p.add_argument("--slug", default="", help="文章 slug（可选）")
    p.add_argument("--title", default="", help="文章标题（可选）")
    p.add_argument("--tags", default="", help="标签，逗号分隔（可选）")
    p.add_argument("--author", default="sal", help="作者 id（可选）")
    p.add_argument("--style", choices=["md", "sml"], default="md", help="输出格式")
    p.add_argument("--dry-run", action="store_true", help="只打印不落盘")
    config.add_site_arg(p)
    p.set_defaults(func=cmd_gen)

    p = sub.add_parser("contracts", help="打印内容契约字段表")
    config.add_site_arg(p)
    p.set_defaults(func=cmd_contracts)

    p = sub.add_parser("build", help="构建")
    p.add_argument("--offline", action="store_true")
    p.add_argument("--contract-loose", action="store_true")
    config.add_site_arg(p)
    p.set_defaults(func=cmd_build)

    p = sub.add_parser("check", help="产物自检")
    config.add_site_arg(p)
    p.set_defaults(func=lambda a: run(str(ENGINE / "check.py"), *_site_arg(a)))

    p = sub.add_parser("test", help="契约引擎自测")
    config.add_site_arg(p)
    p.set_defaults(func=lambda a: run(str(ENGINE / "test_contracts.py"), *_site_arg(a)))

    p = sub.add_parser("preview", help="构建并本地预览")
    p.add_argument("--port", type=int, default=8080)
    p.add_argument("--detach", action="store_true")
    p.add_argument("--no-build", action="store_true")
    config.add_site_arg(p)
    p.set_defaults(func=lambda a: run(str(ENGINE / "preview.py"),
                                      "--port", str(a.port),
                                      *(["--detach"] if a.detach else []),
                                      *(["--no-build"] if a.no_build else []),
                                      *_site_arg(a)))

    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
