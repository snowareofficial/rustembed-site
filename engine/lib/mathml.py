#!/usr/bin/env python3
"""LaTeX → MathML（构建期，零前端 JS）。

latex2mathml 已 vendored 在 engine/vendor，不依赖 pip。
浏览器原生支持 MathML（Chromium 109+/Firefox/Safari），因此不需要 KaTeX/MathJax，
也不产生任何运行时外部请求。
"""
import re
import sys
from pathlib import Path

_VENDOR = Path(__file__).resolve().parent.parent / "vendor"
if str(_VENDOR) not in sys.path:
    sys.path.insert(0, str(_VENDOR))

try:
    from latex2mathml.converter import convert as _convert
except Exception:  # noqa: BLE001
    _convert = None


_CIRCLED = {}
for _i in range(1, 21):
    _CIRCLED[str(_i)] = chr(0x2460 + _i - 1)
for _i, _ch in enumerate("ABCDEFGHIJKLMNOPQRSTUVWXYZ"):
    _CIRCLED[_ch] = chr(0x24B6 + _i)
    _CIRCLED[_ch.lower()] = chr(0x24D0 + _i)

# render() 的结果缓存：{(原表达式, display): MathML}，只活在当次构建进程里
_CACHE = {}


def _normalize_macros(expr):
    """把 OCR 常见的 \\textcircled 宏换成真正的圈号，避免页面出现字面量。"""
    def braced(m):
        token = (m.group(1) or "").strip()
        return _CIRCLED.get(token, m.group(0))

    def bare(m):
        token = (m.group(1) or "").strip()
        return _CIRCLED.get(token, m.group(0))

    expr = re.sub(r"\\textcircled\s*\{\s*([^{}]+?)\s*\}", braced, expr)
    expr = re.sub(r"\\textcircled\s*([0-9A-Za-z])", bare, expr)
    # latex2mathml 对 \displaylimits 和「尺寸命令 + 定界符」支持不完整，先归一化
    expr = re.sub(r"\\displaylimits(?![A-Za-z])", "", expr)
    expr = re.sub(
        r"\\(?:Bigg|bigg|Big|big|Bigl|bigl|Bigr|bigr|Biggl|biggl|Biggr|biggr)\s*(?=\\|[\(\)\[\]\{\}\|])",
        "",
        expr,
    )
    return expr


def render(expr, display=False):
    """返回 MathML 字符串；失败返回空串（调用方回退成代码样式）。

    同一表达式在站内反复出现（同一本书的同一条公式、不同文章引用同一式子），
    而 latex2mathml 是纯函数：按「归一化后的表达式 + 是否 display」缓存结果。
    实测文章阶段 351 次转换里重复串占大头，缓存后该阶段从 ~5.5s 降到 ~1s。
    缓存只活在当次构建进程里（不落盘），内容确定性不受影响。
    """
    key = ((expr or "").strip(), bool(display))
    cached = _CACHE.get(key)
    if cached is not None:
        return cached
    expr = key[0]
    expr = _normalize_macros(expr)
    if not expr or _convert is None:
        _CACHE[key] = ""
        return ""
    try:
        out = _convert(expr)
    except Exception:  # noqa: BLE001
        _CACHE[key] = ""
        return ""
    if not out.startswith("<math"):
        out = ""
    elif display:
        out = out.replace('display="inline"', 'display="block"', 1)
    _CACHE[key] = out
    return out
