"""内容树约定：内容文件的发现与路径推算（唯一事实源）。

目录约定（构建、CLI、旧写作台都从这里取，别再各写一份）：

    content/posts/<四位年份>/[<系列>/]<短名>/index.(md|sml)
    content/posts/<四位年份>/[<系列>/]<短名>/index.<语言>.(md|sml)

  · 独立文章两层、系列文章三层；第一层必须是四位年份；
  · 叶子目录名 = slug = URL，永不改（改了就是断链）；
  · 以 `_` 开头的目录/文件是工具自留地（草稿等），不算内容。

这里只做「路径怎么算」，不读内容、不校验字段 —— 字段校验在 content/*。
"""

import re
from pathlib import PurePosixPath

from engine.core.paths import CONTENT, DOC_EXT

# 正文文件名：index.md / index.sml / index.en.md ……
POST_NAME = re.compile(r"^index(?:\.([a-z]{2}))?\.(md|sml|markdown)$")
LANGS = ("zh", "en")
YEAR_NAME = re.compile(r"^\d{4}$")
SERIES_NAME = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

# 项目自身的说明文件，不是内容条目
SKIP_NAMES = {"readme", "architecture", "changelog", "license", "contributing", "handoff", "todo"}

POSTS_DIR = "posts"


def docs_in(directory, pattern="*"):
    """列出内容文件，跳过项目自身文档（README 等）与下划线开头。"""
    if not directory.exists():
        return []
    out = []
    for p in sorted(directory.glob(pattern)):
        if not p.is_file() or p.suffix.lower() not in DOC_EXT:
            continue
        if p.name.startswith("_") or p.stem.lower() in SKIP_NAMES:
            continue
        out.append(p)
    return out


def iter_posts(posts_root=None):
    """深度无关地列出所有文章正文：yield (文件, 相对 posts/ 的分段)。

    必须用 `*/**/index.*`（而不是 `*/*`）：写死两层会让插进系列子目录的文章
    被静默漏掉 —— 不报错、不收录、线上凭空少一篇。
    """
    root = posts_root or (CONTENT / POSTS_DIR)
    for f in docs_in(root, "*/**/index.*"):
        rel = f.relative_to(root)
        if any(part.startswith("_") for part in rel.parts[:-1]):
            continue
        yield f, rel


def post_lang(name):
    """正文文件名 → 语言代码（index.md 视为 zh，index.en.md 为 en）；不匹配返回 None。"""
    m = POST_NAME.match(name)
    return (m.group(1) or "zh") if m else None


def tails_under_posts(file_field):
    """manifest 里的 file（content/posts/...）→ 相对 posts/ 的分段。"""
    parts = PurePosixPath(file_field).parts
    if POSTS_DIR not in parts:
        return ()
    return parts[parts.index(POSTS_DIR) + 1:]


def new_post_path(year, slug, series="", ext="md"):
    """新文章的落点：content/posts/<年>/[<系列>/]<短名>/index.<ext>。"""
    folder = CONTENT / POSTS_DIR / str(year)
    if series:
        folder = folder / series
    return folder / slug / ("index." + ext)
