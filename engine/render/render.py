"""SML 值 → HTML 片段（rec-blog 专用）。

正文一律先转义再套标签；投稿内容不会以 innerHTML 形式被信任。
块类型：topic/section/para/p/quote/code/ul/ol/li/table/img/a/hr/math/theorem/proof/video/note
内联角色：{ref:}/{term:}/{math:}/{em:}/{strong:}/{link:}
"""

import html

import re
import sys

from engine.core import urls
from engine.render import mathml

QUOTE_ENT = "&quot;"


def esc(s):
    return html.escape("" if s is None else str(s), quote=True)


# 语言名只允许这些字符、最长 20；其余一律退化为 text（防止把作者输入塞进
# class / 文本造成意外，例如 <script> 之类）。与 markdown.py 共用，保证两端一致。
_LANG_RE = re.compile(r"^[A-Za-z0-9_+#-]{1,20}$")


def code_block(lang, code):
    """带语言标签与复制按钮的代码块外壳。

    lang：作者可控输入，仅取 [A-Za-z0-9_+#-]{1,20}，否则显示 text；
    code：代码正文，统一在此 esc。
    产出 <div class="code"> 外壳，<pre><code> 的层级关系不变（<code> 仍在 <pre> 内）。
    markdown.py 与 render.py 共用本函数，确保两个渲染器对同段代码逐字节一致。
    """
    code = esc(code)
    label = ("" if lang is None else str(lang)).strip()
    if label.lower().startswith("language-"):
        label = label[len("language-"):].strip()
    if not _LANG_RE.match(label):
        label = "text"
    cls = "language-" + label
    return (
        '<div class="code">\n'
        '<div class="code-head"><span>%s</span>'
        '<button class="copy" type="button" aria-label="复制代码">复制</button></div>\n'
        '<pre><code class="%s">%s</code></pre>\n'
        '</div>\n'
    ) % (esc(label), esc(cls), code)


def _unquote(arg):
    a = arg.strip()
    if a.startswith(QUOTE_ENT) and a.endswith(QUOTE_ENT) and len(a) >= 12:
        a = a[6:-6]
    a = a.strip('"')
    return a


def _role(inner):
    """inner 取自 apply_roles 传入的**已转义**文本，这里只管套标签。

    不要再 esc() —— 那会把已经转义的 & 变成 &amp;amp;，
    页面就会把 {math:a < b} 显示成字面量 "a &lt; b"、把带参数的链接写坏。
    """
    if ":" not in inner:
        return None
    name, arg = inner.split(":", 1)
    name = name.strip().lower()
    arg = _unquote(arg)
    if name == "ref":
        if "|" in arg:
            target, text = arg.split("|", 1)
        else:
            target = text = arg
        return '<a class="ref" href="#%s">%s</a>' % (target.strip(), text.strip())
    if name == "term":
        return "<dfn>%s</dfn>" % arg
    if name in ("math", "mathtext"):
        # apply_roles 拿到的是已转义文本；公式要还原成原始 LaTeX（否则 < 会变成 &lt; 被拆成字符）
        mm = mathml.render(html.unescape(arg), display=False)
        if mm:
            cls = "math-inline math-text" if name == "mathtext" else "math-inline"
            return '<span class="%s">%s</span>' % (cls, mm)
        return '<code class="math-raw" title="LaTeX">%s</code>' % arg
    if name == "em":
        return "<em>%s</em>" % arg
    if name == "strong":
        return "<strong>%s</strong>" % arg
    if name == "link":
        if "|" in arg:
            url, text = arg.split("|", 1)
        else:
            url = text = arg
        raw = html.unescape(url.strip())
        safe = urls.safe_url(raw)
        if not safe:
            return text.strip()
        return '<a href="%s" target="_blank" rel="nofollow noopener">%s</a>' % (
            esc(safe), text.strip())
    return None


def apply_roles(s):
    """对**已转义**的文本做内联角色替换（{ref:}/{term:}/{math:}/{em:}/{strong:}/{link:}）。"""
    out = []
    i = 0
    while i < len(s):
        if s[i] == "{":
            depth = 1
            j = i + 1
            while j < len(s) and depth:
                if s[j] == "{":
                    depth += 1
                elif s[j] == "}":
                    depth -= 1
                j += 1
            if depth:
                out.append(s[i])
                i += 1
                continue
            rep = _role(s[i + 1:j - 1])
            out.append(rep if rep is not None else s[i:j])
            i = j
        else:
            out.append(s[i])
            i += 1
    return "".join(out)


def inline(s):
    return apply_roles(esc(s))


def slugify(text, used):
    base = re.sub(r"[^\w\u4e00-\u9fff]+", "-", str(text)).strip("-").lower()
    if not base:
        base = "sec"
    slug = base
    k = 2
    while slug in used:
        slug = "%s-%d" % (base, k)
        k += 1
    used.add(slug)
    return slug


class Ctx:
    def __init__(self):
        self.used = set()
        self.toc = []
        self.warnings = []   # 渲染期告警（如 gallery 子块形状非法），由 build.py 抽走登记


def _text_of(v):
    for k in ("title", "__name", "text"):
        s = v.get(k)
        if isinstance(s, str) and s:
            return s
    return ""


def _children(v):
    for k in ("children", "body", "items"):
        c = v.get(k)
        if c is not None:
            return c
    return None


def _term_inner(v, ctx, level):
    """term 块内部文本：逐行保留，行间用 <br>\\n 连接（与 Markdown 完全一致）。

    两种写法都必须逐行保留换行，不允许出现 line1line2 这种行被吞掉的结果：
      - text 字段：按 \\n 拆行，逐行 esc 后 <br>\\n 连接；
      - children 子块：每个子块取纯文本（str 直接 esc、dict 优先取 text 字段，
        否则渲染后去掉外层 <p> 包裹），逐行 <br>\\n 连接。
    与 Markdown 的 :::term 一样不做内联角色替换（仅 esc），保证两端逐字节相等。
    """
    kids = _children(v)
    if kids is not None:
        if not isinstance(kids, list):
            kids = [kids]
        lines = []
        for child in kids:
            if isinstance(child, str):
                lines.append(esc(child))
            elif isinstance(child, dict):
                t = child.get("text")
                if isinstance(t, str):
                    lines.extend(esc(line) for line in t.split("\n"))
                else:
                    html = render(child, ctx, level)
                    m = re.match(r"^<p>(.*)</p>\n?$", html, re.S)
                    lines.append(m.group(1) if m else html.rstrip("\n"))
            else:
                lines.append(esc(str(child)))
        inner = "<br>\n".join(lines)
    else:
        inner = "<br>\n".join(esc(line) for line in _text_of(v).split("\n"))
    return inner


def render(v, ctx=None, level=0):
    ctx = ctx or Ctx()
    if isinstance(v, str):
        return "<p>%s</p>\n" % inline(v)
    if isinstance(v, list):
        return "".join(render(x, ctx, level) for x in v)
    if not isinstance(v, dict):
        return "<p>%s</p>\n" % inline(str(v))
    t = v.get("__type")
    if not isinstance(t, str):
        kids = _children(v)
        return render(kids, ctx, level) if kids is not None else ""
    t = t.lower()

    if t in ("topic", "section", "h1", "h2", "h3", "h4", "h5", "h6"):
        lvl = min(level + 1, 6)
        title = _text_of(v)
        label = v.get("label")
        ident = label if isinstance(label, str) and label else slugify(title, ctx.used)
        ctx.toc.append({"id": ident, "text": title, "level": lvl})
        head = '<h%d id="%s">%s</h%d>\n' % (lvl, esc(ident), inline(title), lvl)
        kids = _children(v)
        return head + (render(kids, ctx, lvl) if kids is not None else "")

    if t in ("para", "p", "text"):
        return "<p>%s</p>\n" % inline(_text_of(v))

    if t in ("quote", "blockquote"):
        kids = _children(v)
        inner = render(kids, ctx, level) if kids is not None else "<p>%s</p>\n" % inline(_text_of(v))
        cite = v.get("cite")
        foot = '<footer>%s</footer>' % inline(cite) if isinstance(cite, str) else ""
        return "<blockquote>%s%s</blockquote>\n" % (inner, foot)

    if t == "code":
        lang = v.get("lang") or v.get("language") or ""
        code = v.get("text") or v.get("code") or ""
        return code_block(lang, code)

    if t in ("ul", "ol"):
        items = _children(v) or []
        lis = "".join("<li>%s</li>\n" % _li(x, ctx, level) for x in items)
        return "<%s>\n%s</%s>\n" % (t, lis, t)

    if t == "li":
        return "<li>%s</li>\n" % _li(v, ctx, level)

    if t == "table":
        head = as_listish(v.get("head"))
        rows = as_listish(v.get("rows"))
        out = ["<table>\n"]
        if head:
            out.append("<thead><tr>" + "".join("<th>%s</th>" % inline(c) for c in head) + "</tr></thead>\n")
        if rows:
            out.append("<tbody>\n")
            for r in rows:
                cells = as_listish(r)
                out.append("<tr>" + "".join("<td>%s</td>" % inline(c) for c in cells) + "</tr>\n")
            out.append("</tbody>\n")
        out.append("</table>\n")
        return "".join(out)

    if t == "img":
        src = urls.safe_url(v.get("src") or v.get("url") or "")
        alt = v.get("alt") or ""
        cap = v.get("caption")
        if not src:
            if ctx is not None and hasattr(ctx, "warnings"):
                ctx.warnings.append("img 的地址不在协议白名单内，已省略")
            return '<p class="muted">（图片已省略）</p>\n'
        img = '<img src="%s" alt="%s" loading="lazy">' % (esc(src), esc(alt))
        if isinstance(cap, str) and cap:
            return '<figure>%s<figcaption>%s</figcaption></figure>\n' % (img, inline(cap))
        return "<p>%s</p>\n" % img

    if t == "a":
        href = urls.safe_url(v.get("href") or v.get("url") or "")
        if not href:
            return "<p>%s</p>\n" % inline(_text_of(v))
        return '<p><a href="%s" target="_blank" rel="nofollow noopener">%s</a></p>\n' % (
            esc(href), inline(_text_of(v) or href))

    if t == "hr":
        return "<hr>\n"

    if t == "math":
        expr = _text_of(v)
        mm = mathml.render(expr, display=True)
        if mm:
            cls = "math-block math-text" if v.get("font") == "text" else "math-block"
            return '<div class="%s">%s</div>\n' % (cls, mm)
        return '<pre class="math-raw">%s</pre>\n' % esc(expr)

    if t == "theorem":
        title = _text_of(v)
        label = v.get("label")
        ident = label if isinstance(label, str) and label else slugify(title or "theorem", ctx.used)
        head = '<h3 class="theorem-title">%s</h3>\n' % inline(title) if title else ""
        kids = render(_children(v), ctx, level)
        return '<article class="theorem" id="%s">%s%s</article>\n' % (esc(ident), head, kids)

    if t == "proof":
        kids = render(_children(v), ctx, level)
        return '<div class="proof">%s</div>\n' % kids

    if t == "video":
        return video_embed(v.get("bvid") or v.get("url") or "")

    if t in ("note", "tip", "warn", "warning"):
        kind = {"note": "note", "tip": "tip", "warn": "warn", "warning": "warn"}[t]
        kids = _children(v)
        inner = render(kids, ctx, level) if kids is not None else "<p>%s</p>\n" % inline(_text_of(v))
        return '<aside class="admonition %s">%s</aside>\n' % (kind, inner)

    if t == "panel":
        title = _text_of(v)
        kids = _children(v)
        inner = render(kids, ctx, level) if kids is not None else ""
        head = '<p class="panel-t">%s</p>\n' % inline(title) if title else ""
        return '<aside class="panel">%s%s</aside>\n' % (head, inner)

    if t == "steps":
        items = _children(v) or []
        # 每个 <li> 内不得套 <p>（复用 _li，与 Markdown 的 :::steps 一致）
        lis = "".join("<li>%s</li>\n" % _li(item, ctx, level) for item in items)
        return "<ol class=\"steps\">\n%s</ol>\n" % lis

    if t == "shot":
        src = urls.safe_url(v.get("src") or v.get("url") or "")
        alt = v.get("alt") or ""
        cap = v.get("caption")
        full = bool(v.get("full"))
        if not src:
            if ctx is not None and hasattr(ctx, "warnings"):
                ctx.warnings.append("shot 的地址不在协议白名单内，已省略")
            return '<p class="muted">（图片已省略）</p>\n'
        img = '<img src="%s" alt="%s" loading="lazy">' % (esc(src), esc(alt))
        open_tag = '<figure class="full">' if full else "<figure>"
        if isinstance(cap, str) and cap:
            result = "%s\n%s<figcaption>%s</figcaption>\n</figure>\n" % (open_tag, img, inline(cap))
        else:
            result = "%s\n%s\n</figure>\n" % (open_tag, img)
        return result

    if t == "gallery":
        cols = v.get("cols") or "2"
        items = _children(v) or []
        figs = []
        for item in items:
            if isinstance(item, dict) and item.get("__type") == "img":
                src = urls.safe_url(item.get("src") or item.get("url") or "")
                alt = item.get("alt") or ""
                cap = item.get("caption")
                if not src:
                    if ctx is not None and hasattr(ctx, "warnings"):
                        ctx.warnings.append("gallery 里有图片地址不在协议白名单内，已跳过")
                    continue
                img = '<img src="%s" alt="%s" loading="lazy">' % (esc(src), esc(alt))
                if isinstance(cap, str) and cap:
                    figs.append('<figure>%s<figcaption>%s</figcaption></figure>\n' % (img, inline(cap)))
                else:
                    figs.append('<figure>%s</figure>\n' % img)
            else:
                # 形状不对（例如裸 {src: …}）：登记告警并跳过该子块，不静默丢弃
                msg = "gallery 子块不是 img 形状，已跳过：%r" % (item,)
                if ctx is not None and hasattr(ctx, "warnings"):
                    ctx.warnings.append(msg)
                else:
                    print("警告：" + msg, file=sys.stderr)
        if not figs:
            msg = "gallery 没有可用图片，已跳过空图集"
            if ctx is not None and hasattr(ctx, "warnings"):
                ctx.warnings.append(msg)
            else:
                print("警告：" + msg, file=sys.stderr)
            return ""
        return '<div class="gallery cols-%s">\n%s</div>\n' % (esc(str(cols)), "".join(figs))

    if t == "term":
        return '<div class="term">\n%s\n</div>\n' % _term_inner(v, ctx, level)

    if t == "when":
        date = v.get("date") or v.get("datetime") or ""
        kids = _children(v)
        if kids is not None:
            text = render(kids, ctx, level).strip()
            m = re.match(r"^<p>(.*)</p>$", text, re.S)
            text = m.group(1) if m else text
        else:
            # 事件正文的唯一来源：优先取 text 字段，缺失时回退 _text_of
            text = v.get("text")
            if not isinstance(text, str) or not text:
                text = _text_of(v)
        return '<li class="when">\n<span class="when-t">%s</span>\n%s\n</li>\n' % (inline(date), inline(text))

    kids = _children(v)
    if kids is not None:
        return render(kids, ctx, level)
    if _text_of(v):
        return "<p>%s</p>\n" % inline(_text_of(v))
    return ""


def _li(x, ctx, level):
    if isinstance(x, dict):
        kids = _children(x)
        if kids is not None:
            return render(kids, ctx, level)
        return inline(_text_of(x))
    return inline(str(x))


def as_listish(v):
    if v is None:
        return []
    if isinstance(v, list):
        return v
    return [v]


def video_embed(ref):
    """B 站视频：只接受 BV 号，白名单外返回空串。

    不直接嵌 iframe —— 站点约定「零第三方请求」，iframe 会在每次打开页面时
    连 B 站并暴露访问者 IP。这里输出一个门面卡（poster + 播放按钮），
    用户点击后才由主题 JS（js/core.js 的委派点击）注入 iframe。
    """
    ref = str(ref).strip()
    bvid = ""
    if ref.startswith("BV") and len(ref) >= 12:
        bvid = ref
    else:
        m = re.search(r"(BV[0-9A-Za-z]{10})", ref)
        if m and ("bilibili.com" in ref or ref.startswith("BV")):
            bvid = m.group(1)
    if not bvid:
        return ""
    src = "https://player.bilibili.com/player.html?bvid=%s&high_quality=1" % bvid
    watch = "https://www.bilibili.com/video/%s" % bvid
    return (
        '<div class="video" data-embed="%s">'
        '<a class="video-face" href="%s" rel="noopener">'
        '<span class="video-play" aria-hidden="true">▶</span>'
        '<span class="video-label">在 B 站观看 %s（点击加载播放器）</span>'
        '</a></div>\n' % (esc(src), esc(watch), esc(bvid))
    )


def strip_html(s):
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def math_block(expr, text_font=False):
    """Markdown 的 $$...$$ 块公式；text_font=True 时用正文字体（Times）。失败回退代码块。"""
    mm = mathml.render(expr, display=True)
    if mm:
        cls = "math-block math-text" if text_font else "math-block"
        return '<div class="%s">%s</div>\n' % (cls, mm)
    return '<pre class="math-raw">%s</pre>\n' % esc(expr)
