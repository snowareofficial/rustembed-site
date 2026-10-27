"""图片引用体检：内容 / 主题 / 产物里的图片引用，识别逻辑只放这一份。

为什么单独一个模块：三个调用方要的是同一件事的不同侧面 ——
  · build.py      构建期：内容里出现 http(s) 图片引用就直接失败（运行时零外部请求）；
  · check.py      检查期：产物里被引用的图必须存在、非 0 字节、格式没被写错；
  · audit_images.py 报告期：给人一张「文件 | 行号 | 引用 | 问题 | 建议」的表。
「怎么找出引用」和「怎么认一个文件是不是真图」各处各写一遍，迟早漂移成
「审计说没问题、构建却炸」。所以解析与判定都收在这里。

本模块只读文件、不发请求：下载外链图是人的决定（授权 / 版权），不是脚本的决定。
"""

import re
from pathlib import Path

# 与 build.py 的 IMAGE_EXT 保持一致（构建期附件与 assets/ 目录校验用同一张表）
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif", ".bmp"}

# magic bytes → 格式名。SVG 是文本，按前缀认；下载到 HTML 错误页也走这张表认出来。
_SNIFFERS = (
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"\xff\xd8\xff", "jpeg"),
    (b"GIF87a", "gif"),
    (b"GIF89a", "gif"),
    (b"BM", "bmp"),
)

# 扩展名 → 格式名（.jpg 与 .jpeg 同族，认成 jpeg）
_EXT_FMT = {".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg", ".gif": "gif",
            ".bmp": "bmp", ".avif": "avif", ".webp": "webp", ".svg": "svg"}

# SML 里可能承载图片路径的键（shot/gallery/img 的 src、成员 avatar、封面 cover…）
_SML_IMAGE_KEYS = ("src", "image", "cover", "avatar", "logo", "icon", "poster", "banner")

_MD_IMG = re.compile(r"!\[[^\]]*\]\(\s*([^)\s]+)")
_HTML_IMG = re.compile(r"<img\b[^>]*?\bsrc\s*=\s*\"([^\"]+)\"", re.I)
_CSS_URL = re.compile(r"url\(\s*['\"]?([^'\")]+)['\"]?\s*\)", re.I)
_INLINE_CODE = re.compile(r"`[^`\n]*`")
# 主题 JS 里写死的图片路径（字符串字面量里的 .png/.jpg…）
_JS_IMG = re.compile(r"""['"]([^'"\s]+\.(?:png|jpe?g|gif|webp|svg|avif|bmp)(?:\?[^'"\s]*)?)['"]""", re.I)
# SML 里的 `键: "值"`（含 img {{ src: "..." }} 的裸块写法）
_SML_KV = re.compile(r"\b(%s)\s*:\s*\"([^\"]+)\"" % "|".join(_SML_IMAGE_KEYS))


def is_external(ref):
    """http(s) / 协议相对都算外链：运行时会真的发出跨站请求。"""
    r = str(ref or "").strip()
    return r.startswith(("http://", "https://", "//"))


def is_image_ref(ref):
    """按扩展名判断是不是图片引用（查询串 / 片段先剥掉）。"""
    r = str(ref or "").strip().split("?")[0].split("#")[0]
    return Path(r).suffix.lower() in IMAGE_EXT


def sniff(data):
    """读 magic bytes 认格式；认不出来返回 None（调用方自己决定算不算坏图）。"""
    if not data:
        return None
    if data[:5] == b"<?xml" or data[:4] == b"<svg" or b"<svg" in data[:512]:
        return "svg"
    for magic, fmt in _SNIFFERS:
        if data.startswith(magic):
            return fmt
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data[:4] == b"ftyp":
        return "avif"                     # ISO-BMFF：avif/heif 都落这里
    return None


def fmt_of_ext(path):
    """扩展名期望的格式名；不在表里返回 None（构建期白名单外的类型）。"""
    return _EXT_FMT.get(Path(str(path)).suffix.lower())


def looks_like_html(data):
    """「下载到的是错误页」：认不出图片格式，但内容是 HTML。"""
    if not data:
        return False
    head = data[:512].lstrip().lower()
    return head.startswith(b"<!doctype") or head.startswith(b"<html") or b"<html" in head


def probe(path):
    """体检一个本地图片文件，返回 dict（不抛异常：坏图正是要报告的东西）。"""
    out = {"path": str(path), "exists": False, "size": 0, "fmt": None, "want": None,
           "zero": False, "bad_magic": False, "html_page": False}
    try:
        p = Path(path)
        if not p.is_file():
            return out
        out["exists"] = True
        data = p.read_bytes()
    except OSError:
        return out
    out["size"] = len(data)
    out["zero"] = out["size"] == 0
    out["fmt"] = sniff(data)
    out["want"] = fmt_of_ext(p)
    out["html_page"] = looks_like_html(data)
    out["bad_magic"] = bool(out["fmt"] and out["want"] and out["fmt"] != out["want"])
    return out


def _strip_fences(lines):
    """Markdown：标出落在 ``` / ~~~ 代码块里的行号（1 基）。

    文档里教「图片怎么写」的示例（`![说明](assets/x.png)`）就在代码块里，
    不排除就会把教程示例当成坏引用报出来 —— 误报比漏报更伤审计的可信度。
    """
    fenced = set()
    fence = None
    for i, line in enumerate(lines, 1):
        s = line.strip()
        if fence is None:
            m = re.match(r"^(```+|~~~+)", s)
            if m:
                fence = m.group(1)[0]
                fenced.add(i)
                continue
        else:
            fenced.add(i)
            if re.match(r"^(```+|~~~+)", s):
                fence = None
    return fenced


def md_image_refs(text):
    """Markdown 正文里的图片引用 → [(行号, 引用), ...]；代码块与行内代码不计。"""
    lines = text.splitlines()
    skip = _strip_fences(lines)
    out = []
    for i, line in enumerate(lines, 1):
        if i in skip:
            continue
        cleaned = _INLINE_CODE.sub("", line)
        for m in _MD_IMG.finditer(cleaned):
            out.append((i, m.group(1)))
    return out


def sml_key_refs(text):
    """SML 里显式声明图片的键（shot/gallery 的 src、成员 avatar、封面 cover…）。"""
    return [(i, m.group(2)) for i, line in enumerate(text.splitlines(), 1)
            for m in _SML_KV.finditer(line)]


def sml_text_refs(text):
    """SML 字符串里的 Markdown 图（正文/文档示例都长这样）。

    与 sml_key_refs 分开：文档页教语法时会在表格格里写 `![说明](assets/x.png)`，
    渲染出来是转义文本而不是 <img>，把它当坏引用报出来就是误报。所以这类引用
    只在外链检查里算数（外链在任何位置都不该出现），本地存在性不查。
    """
    out = []
    for i, line in enumerate(text.splitlines(), 1):
        if _SML_KV.search(line):
            continue                     # 键值行交给 sml_key_refs，别重复报
        for m in _MD_IMG.finditer(line):
            out.append((i, m.group(1)))
    return out


def html_image_refs(text):
    """HTML 里的 <img src> → [(行号, 引用), ...]（主题壳与产物片段共用）。"""
    return [(i, m.group(1)) for i, line in enumerate(text.splitlines(), 1)
            for m in _HTML_IMG.finditer(line)]


def css_url_refs(text):
    """CSS 里的 url(...) → [(行号, 引用), ...]，只报图片（背景图也算图片）。"""
    out = []
    for i, line in enumerate(text.splitlines(), 1):
        for m in _CSS_URL.finditer(line):
            ref = m.group(1)
            if is_image_ref(ref):
                out.append((i, ref))
    return out


def js_string_refs(text):
    """JS 里写死的图片路径 → [(行号, 引用), ...]（主题壳专用）。"""
    return [(i, m.group(1)) for i, line in enumerate(text.splitlines(), 1)
            for m in _JS_IMG.finditer(line)]


def text_refs(path, text):
    """图片引用 → [(行号, 引用, 来源), ...]。

    来源五种，调用方据此决定严格程度：
      md       Markdown 正文（本地缺失要报）
      sml-key  SML 里显式的图片键（本地缺失要报）
      sml-text SML 字符串里的 Markdown 图（可能是文档示例，只查外链）
      html     <img src>
      css      url(...)
      js       字符串字面量里的图片路径（只查外链，本地路径由构建拷贝保证）
    """
    suffix = Path(path).suffix.lower()
    if suffix == ".md":
        # Markdown 里可以写原生 HTML，<img src> 与 ![]() 都得收
        return ([(i, r, "md") for i, r in md_image_refs(text)]
                + [(i, r, "html") for i, r in html_image_refs(text)])
    if suffix == ".sml":
        return ([(i, r, "sml-key") for i, r in sml_key_refs(text)]
                + [(i, r, "sml-text") for i, r in sml_text_refs(text)])
    if suffix in (".html", ".htm"):
        return [(i, r, "html") for i, r in html_image_refs(text)]
    if suffix == ".css":
        return [(i, r, "css") for i, r in css_url_refs(text)]
    if suffix == ".js":
        return [(i, r, "js") for i, r in js_string_refs(text)]
    return []
