#!/usr/bin/env python3
"""LaTeX → MathML（构建期，零前端 JS）。

latex2mathml 已 vendored 在 engine/vendor，不依赖 pip。
浏览器原生支持 MathML（Chromium 109+/Firefox/Safari），因此不需要 KaTeX/MathJax，
也不产生任何运行时外部请求。
"""
import sys
from pathlib import Path

_VENDOR = Path(__file__).resolve().parent.parent / "vendor"
if str(_VENDOR) not in sys.path:
    sys.path.insert(0, str(_VENDOR))

try:
    from latex2mathml.converter import convert as _convert
except Exception:  # noqa: BLE001
    _convert = None


def render(expr, display=False):
    """返回 MathML 字符串；失败返回空串（调用方回退成代码样式）。"""
    expr = (expr or "").strip()
    if not expr or _convert is None:
        return ""
    try:
        out = _convert(expr)
    except Exception:  # noqa: BLE001
        return ""
    if not out.startswith("<math"):
        return ""
    if display:
        out = out.replace('display="inline"', 'display="block"', 1)
    return out
