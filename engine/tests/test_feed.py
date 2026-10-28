#!/usr/bin/env python3
"""RSS feed 回归：同一系列只出一条，按最近一章日期排序。

    python engine/tests/test_feed.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from engine.pipeline.manifest import feed_xml  # noqa: E402


def post(slug, date, series="", title=None, summary="摘要", series_title="系列"):
    return {
        "slug": slug, "date": date, "series": series,
        "title": title or slug, "summary": summary, "series_title": series_title,
    }


def test_series_collapses_to_one_item():
    manifest = {
        "site": {"url": "https://example.test", "title": "T", "tagline": "D"},
        "series": [{"id": "s1", "title": "系列一", "description": "系列简介"}],
    }
    xml = feed_xml(manifest, [
        post("standalone", "2026-01-03", title="单篇"),
        post("s1-a", "2026-01-01", series="s1", title="第一章"),
        post("s1-b", "2026-01-04", series="s1", title="第二章"),
    ])
    assert xml.count("<item>") == 2, xml
    assert "<title>系列一</title>" in xml, xml
    assert "<link>https://example.test/#/series/s1</link>" in xml, xml
    assert "系列简介" in xml, xml
    assert "第一章" not in xml and "第二章" not in xml, xml
    # 单篇仍在
    assert "<title>单篇</title>" in xml, xml


def test_limit_is_20_entries_and_sorted_desc():
    manifest = {
        "site": {"url": "https://example.test", "title": "T", "tagline": "D"},
        "series": [],
    }
    posts = [post("p%02d" % i, "2026-01-%02d" % (i + 1)) for i in range(25)]
    xml = feed_xml(manifest, posts)
    assert xml.count("<item>") == 20, xml
    first = xml.split("<item>", 1)[1]
    assert "<title>p24</title>" in first, first
    assert "<title>p00</title>" not in xml, xml


if __name__ == "__main__":
    test_series_collapses_to_one_item()
    test_limit_is_20_entries_and_sorted_desc()
    print("FEED PASS（2 项）")
