#!/usr/bin/env python3
"""从字体压缩包里挑出需要的权重，放进站点字体目录（不整包解压）。

    python engine/tools/fonts_import.py MiSans.zip
    python engine/tools/fonts_import.py MiSans.zip --weights Regular,Bold,Medium
    python engine/tools/fonts_import.py MiSans.zip --list          # 只看压缩包里有什么

产物：
    site/fonts/src/*.ttf（源字体，不入库）
    site/fonts/LICENSE-*.txt（字体自带的许可文件，随仓库保留）
之后构建会把它子集化成 site/fonts/subset/*.woff2（入库、体积小）。
"""

import argparse
import re
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from engine.core import config  # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass

FONT_EXT = (".ttf", ".otf", ".woff2", ".woff")
SKIP_MARK = ("__MACOSX/", ".DS_Store", "/._")
LICENSE_HINT = ("license", "licence", "许可", "版权")


def entries(z):
    out = []
    for info in z.infolist():
        n = info.filename
        if info.is_dir() or any(m in n for m in SKIP_MARK):
            continue
        out.append(info)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("archive")
    ap.add_argument("--weights", default="Regular,Bold",
                    help="要提取的权重名（逗号分隔，匹配文件名，不区分大小写）")
    ap.add_argument("--list", action="store_true", help="只列出压缩包内容")
    ap.add_argument("--dest", default="", help="目标目录（默认 site/fonts/src）")
    args = ap.parse_args()

    z = zipfile.ZipFile(args.archive)
    items = entries(z)

    if args.list:
        for i in items:
            print("%9.0f KB  %s" % (i.file_size / 1024, i.filename))
        return 0

    dest = Path(args.dest) if args.dest else config.SITE / "fonts" / "src"
    dest.mkdir(parents=True, exist_ok=True)

    weights = [w.strip().lower() for w in args.weights.split(",") if w.strip()]

    # 每个权重优先 ttf，其次 otf，最后 woff2
    # 只认「最后一个连字符/下划线之后」的权重名，避免 bold 命中 demibold / semibold
    picked = {}
    for i in items:
        p = Path(i.filename)
        if p.suffix.lower() not in FONT_EXT:
            continue
        tail = re.split(r"[-_ ]", p.stem)[-1].lower()
        if tail not in weights:
            continue
        rank = FONT_EXT.index(p.suffix.lower())
        if tail not in picked or rank < picked[tail][0]:
            picked[tail] = (rank, i)
    if not picked:
        print("压缩包里没找到这些权重：%s" % ", ".join(weights))
        print("用 --list 看看实际有什么。")
        return 1

    total = 0
    for w in weights:
        if w not in picked:
            print("  ! 未找到权重 %s" % w)
            continue
        info = picked[w][1]
        dst = dest / Path(info.filename).name
        with z.open(info) as src, open(dst, "wb") as fh:
            fh.write(src.read())
        total += dst.stat().st_size
        print("  提取 %s  (%.1f MB)" % (dst.name, dst.stat().st_size / 1024 / 1024))

    for i in items:
        low = i.filename.lower()
        if any(h in low for h in LICENSE_HINT) and Path(i.filename).suffix.lower() in (".txt", ".md", ".pdf", ""):
            dst = dest.parent / ("LICENSE-" + Path(i.filename).name)
            with z.open(i) as src, open(dst, "wb") as fh:
                fh.write(src.read())
            print("  许可文件 → %s" % dst.name)

    print("\n源字体共 %.1f MB（在 %s，已 gitignore；只有子集会入库）"
          % (total / 1024 / 1024, dest.relative_to(config.REPO)))
    print("下一步：pip install fonttools brotli && python engine/cli.py build")
    print("提示：源压缩包可删除，源字体不必入库。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
