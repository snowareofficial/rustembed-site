#!/usr/bin/env python3
"""构建期摘要：优先用 site/content/summaries/<slug>.json（AI 产物），否则抽取式。

约定（给 AI 步骤 / GUI 用）：输入是文章的 title/summary/正文纯文本；输出 JSON：
{
  "one_line": "一句话摘要（<=60 字）",
  "points": ["3-6 条要点，每条 <=40 字"],
  "keywords": ["3-6 个关键词"]
}
把结果写到 site/content/summaries/<slug>.json 即可在下次构建时被采用；
没有该文件时用抽取式（摘要字段 + 章节标题 + 标签），并在 UI 标注来源。
"""
import json


def build(post, summaries_dir):
    slug = post.get("slug") or ""
    path = summaries_dir / (slug + ".json")
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return {
                    "source": "ai",
                    "one_line": str(data.get("one_line") or post.get("summary") or ""),
                    "points": [str(x) for x in (data.get("points") or [])][:8],
                    "keywords": [str(x) for x in (data.get("keywords") or [])][:8],
                    "reading": max(1, round((post.get("words") or 0) / 300)),
                }
        except (ValueError, OSError):
            pass
    points = [str(t.get("text") or "") for t in (post.get("toc") or []) if t.get("text")]
    return {
        "source": "extractive",
        "one_line": str(post.get("summary") or ""),
        "points": points[:6],
        "keywords": [str(x) for x in (post.get("tags") or [])][:8],
        "reading": max(1, round((post.get("words") or 0) / 300)),
    }
