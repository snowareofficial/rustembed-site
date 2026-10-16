#!/usr/bin/env python3
"""MD ↔ SML 渲染一致性证据脚本（零第三方依赖）。

    python engine/verify_parity.py

逐对给出 (Markdown 源码, SML 值) 两条等价输入，比对
markdown.render(md_text) 与 render.render(sml_value) 的逐字节 HTML。
本脚本的 stdout 即交付证据：末尾打印「一致 N / 不一致 M」，存在不一致时退出码 1。

覆盖块：panel、shot（普通/full，都带图注）、gallery（2 张 / 1 张 / 0 张）、
term（text 多行 / children 多行）、steps（1. 与 - 两种输入）、when（单行/多行）。

与 `test_render_safety.py` §5 的关系（避免"两处真相"）：
**同一条不变量（MD↔SML 逐字节一致）同时被两处覆盖，这是刻意的**——
§5 是 CI 门禁，走完整渲染路径（含 ctx 与后续处理）；本脚本是给人看的单体证据，
输出更直白、可单独运行。**改动对照表时两处都要同步**：§5 里的 `_parity` 列表
与本文件共用同一组用例（脚本当前是 §5 的子集：不含 steps/gallery 的边界组合）。
"""

import sys
from pathlib import Path

ENGINE = Path(__file__).resolve().parent
sys.path.insert(0, str(ENGINE))
sys.path.insert(0, str(ENGINE / "lib"))

import markdown as md
import render as R

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass


def md_html(text):
    h, _ = md.render(text)
    return h


# 对照表：(块名, Markdown 源码, SML 值)
CASES = [
    ("panel",
     ":::panel 结论先行\n正文内容\n:::",
     {"__type": "panel", "title": "结论先行", "children": ["正文内容"]}),

    ("shot 普通带图注",
     ':::shot\n![接线](assets/a.png "图注")\n:::',
     {"__type": "shot", "src": "assets/a.png", "alt": "接线", "caption": "图注"}),

    ("shot full 带图注",
     ':::shot full\n![接线](assets/a.png "图注")\n:::',
     {"__type": "shot", "src": "assets/a.png", "alt": "接线", "caption": "图注", "full": True}),

    ("gallery 2 张",
     ":::gallery 2\n![](a.png)\n![](b.png)\n:::",
     {"__type": "gallery", "cols": "2",
      "children": [{"__type": "img", "src": "a.png"}, {"__type": "img", "src": "b.png"}]}),

    ("gallery 1 张",
     ":::gallery\n![](a.png)\n:::",
     {"__type": "gallery",
      "children": [{"__type": "img", "src": "a.png"}]}),

    ("gallery 0 张",
     ":::gallery 2\n:::",
     {"__type": "gallery", "children": []}),

    ("term text 多行",
     ":::term\n$ cargo build\nFinished\n:::",
     {"__type": "term", "text": "$ cargo build\nFinished"}),

    ("term children 多行",
     ":::term\n$ cargo build\nFinished\n:::",
     {"__type": "term", "children": ["$ cargo build", "Finished"]}),

    ("steps 短横",
     ":::steps\n- 装工具链\n- 配环境\n:::",
     {"__type": "steps", "items": ["装工具链", "配环境"]}),

    ("steps 数字",
     ":::steps\n1. 装工具链\n2. 配环境\n:::",
     {"__type": "steps", "items": ["装工具链", "配环境"]}),

    ("when 单行",
     ":::when 2026-10-16 围栏落地\n:::",
     {"__type": "when", "date": "2026-10-16", "text": "围栏落地"}),

    ("when 多行",
     ":::when 2026-10-16\n围栏落地 补齐渲染。\n:::",
     {"__type": "when", "date": "2026-10-16", "text": "围栏落地 补齐渲染。"}),
]


def main():
    print("== MD ↔ SML 渲染一致性验证 ==")
    ok = 0
    bad = 0
    for name, md_text, sml_value in CASES:
        h_md = md_html(md_text)
        h_sml = R.render(sml_value, R.Ctx())
        if h_md == h_sml:
            ok += 1
            print("  [一致]   %s" % name)
        else:
            bad += 1
            print("  [不一致] %s" % name)
            print("      MD : %s" % repr(h_md))
            print("      SML: %s" % repr(h_sml))
    print("\n一致 %d / 不一致 %d" % (ok, bad))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
