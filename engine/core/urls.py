#!/usr/bin/env python3
"""URL 协议白名单：所有拼进 href/src 的用户输入都必须过这里。

允许：http / https / mailto / tel、页内锚点 `#...`、相对路径（assets/...）；
拒绝：javascript: / data: / vbscript: / file:、协议相对 `//host`、控制字符。
"""
import re
from urllib.parse import urlsplit

ALLOWED_SCHEMES = ("http", "https", "mailto", "tel")
_CTRL = re.compile(r"[\x00-\x1f\x7f]")


def safe_url(value):
    """返回可安全放进 href/src 的字符串；不安全返回空串。"""
    s = str(value or "").strip()
    if not s or _CTRL.search(s):
        return ""
    if s.startswith("#"):
        return s
    if s.startswith("//"):
        return ""
    try:
        parts = urlsplit(s)
    except ValueError:
        return ""
    if parts.scheme:
        return s if parts.scheme.lower() in ALLOWED_SCHEMES else ""
    return s
