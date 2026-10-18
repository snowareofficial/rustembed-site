"""Markdown 子集渲染器（投稿默认格式）。

输出与 SML 渲染共用同一套标签与 class，因此样式、章节树（导图）、搜索索引全部复用。
支持：front matter（YAML 子集）、ATX 标题、段落、围栏/缩进代码、引用、有序/无序列表（含一层嵌套）、
表格、水平线、图片（可带 caption）、链接、粗体/斜体/删除线/行内代码、单独一行的 B 站视频、
以及 SML 的内联角色 {ref:}/{term:}/{math:}/{em:}/{strong:}/{link:}；正文里的 HTML 一律转义。

若将来要完整 CommonMark（脚注、定义列表、自动链接等），把 render() 换成外部引擎
（Hugo / pandoc / python-markdown）即可 —— 只要保持 (html, toc) 的出口签名不变。
"""

import re
import sys

import render as R

BV_RE = re.compile(r"^(?:<?https?://(?:www\.)?bilibili\.com/video/)?(BV[0-9A-Za-z]{10})>?$")


def _scalar(v):
    v = v.strip()
    if v.startswith("[") and v.endswith("]"):
        inner = v[1:-1].strip()
        if not inner:
            return []
        # 逗号分隔优先；没有逗号时按空白分隔（兼容 `[ rust embedded ]` 这种写法）。
        # 空白分支保留引号内空格：`[ "New York" ]` 仍是一个元素。
        if "," in inner:
            parts = [x for x in re.split(r"\s*,\s*", inner) if x]
        else:
            parts = re.findall(r'"[^"]*"|\'[^\']*\'|[^\s]+', inner)
        return [_scalar(x) for x in parts]
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        v = v[1:-1]
    low = v.lower()
    if low in ("true", "yes"):
        return True
    if low in ("false", "no"):
        return False
    if low in ("null", "~", ""):
        return None
    if re.fullmatch(r"[+-]?\d+", v):
        return int(v)
    if re.fullmatch(r"[+-]?\d+\.\d+", v):
        return float(v)
    return v


def _yaml_subset(lines):
    out = {}
    key = None
    cur = None
    for raw in lines:
        if not raw.strip() or raw.strip().startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        s = raw.strip()
        if indent == 0:
            cur = None
            if ":" not in s:
                continue
            k, v = s.split(":", 1)
            k, v = k.strip(), v.strip()
            if v == "":
                out[k] = None
                key = k
            else:
                out[k] = _scalar(v)
                key = None
            continue
        if key is None:
            continue
        if s.startswith("- "):
            if not isinstance(out.get(key), list):
                out[key] = []
            body = s[2:].strip()
            if ":" in body and not body.startswith(("http://", "https://")):
                k, v = body.split(":", 1)
                cur = {k.strip(): _scalar(v)}
                out[key].append(cur)
            else:
                cur = None
                out[key].append(_scalar(body))
            continue
        if ":" not in s:
            continue
        k, v = s.split(":", 1)
        if isinstance(out.get(key), list) and cur is not None:
            cur[k.strip()] = _scalar(v)
        elif isinstance(out.get(key), dict):
            out[key][k.strip()] = _scalar(v)
        else:
            out[key] = {k.strip(): _scalar(v)}
    return out


def split_front_matter(text):
    text = text[1:] if text.startswith("\ufeff") else text
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    if not lines or lines[0].strip() not in ("---", "+++"):
        return {}, text
    close = None
    for i in range(1, len(lines)):
        if lines[i].strip() in ("---", "+++"):
            close = i
            break
    if close is None:
        return {}, text
    return _yaml_subset(lines[1:close]), "\n".join(lines[close + 1:])


def _inline_code_stash(s, store):
    def repl(m):
        store.append(m.group(1))
        return "\x00%d\x00" % (len(store) - 1)
    return re.sub(r"`([^`]+)`", repl, s)


def _inline_math_stash(s, store):
    """先于转义把 $...$ / $$...$$ 抠出来，避免 LaTeX 反斜杠被 esc 破坏。"""
    def repl(m):
        store.append(m.group(1))
        return "\x01%d\x01" % (len(store) - 1)
    s = re.sub(r"\$\$([^$]+?)\$\$", repl, s)
    s = re.sub(r"(?<![\\$])\$([^$\n]+?)\$", repl, s)
    return s


def md_inline(s):
    store = []
    mathstore = []
    s = _inline_code_stash(s, store)      # 行内代码优先（里面的 $ 不处理）
    s = _inline_math_stash(s, mathstore)
    s = R.esc(s)

    def img(m):
        alt, src = m.group(1), m.group(2)
        cap = m.group(3)
        # src/alt 都来自本函数开头已整体转义过的 s，这里再 esc 一次会把 & 变成 &amp;amp;
        tag = '<img src="%s" alt="%s" loading="lazy">' % (src, alt)
        if cap:
            return '<figure>%s<figcaption>%s</figcaption></figure>' % (tag, cap)
        return tag

    s = re.sub(r"!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)", img, s)
    s = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)",
               lambda m: '<a href="%s" target="_blank" rel="nofollow noopener">%s</a>' % (m.group(2), m.group(1)), s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<em>\1</em>", s)
    s = re.sub(r"~~([^~]+)~~", r"<del>\1</del>", s)
    s = R.apply_roles(s)
    for i, expr in enumerate(mathstore):
        mm = R.mathml.render(expr, display=False)
        s = s.replace("\x01%d\x01" % i,
                      '<span class="math-inline">%s</span>' % mm if mm
                      else '<code class="math-raw">%s</code>' % R.esc(expr))
    for i, code in enumerate(store):
        s = s.replace("\x00%d\x00" % i, "<code>%s</code>" % code)
    return s


def _list_html(lines, ctx):
    items = []
    for raw in lines:
        m = re.match(r"^(\s*)([-*+]|\d+[.)])\s+(.*)$", raw)
        if m:
            items.append([len(m.group(1)), m.group(2)[0].isdigit(), [m.group(3)]])
        elif items:
            items[-1][2].append(raw.strip())
    if not items:
        return ""

    def build(idx, indent):
        """返回 (若干 <li> 拼成的 html, 下一个待处理下标)。

        早期版本返回的是 list 却按 str 使用：一层嵌套会把 Python 的
        ['<li>…'] 直接打印到页面，缩进错位则抛 TypeError 崩掉构建。
        子列表由本层补上 <ul>/<ol> 外壳，避免产出没有列表容器的裸 <li>。
        """
        out = []
        while idx < len(items):
            ind, ordered, texts = items[idx]
            if ind < indent:
                break
            if ind > indent:
                child_tag = "ol" if ordered else "ul"
                sub, idx = build(idx, ind)
                if out:
                    out[-1] = out[-1].replace(
                        "</li>\n", "<%s>\n%s</%s>\n</li>\n" % (child_tag, sub, child_tag))
                continue
            idx += 1
            nested = ""
            if idx < len(items) and items[idx][0] > indent:
                child_tag = "ol" if items[idx][1] else "ul"
                sub, idx = build(idx, items[idx][0])
                nested = "<%s>\n%s</%s>\n" % (child_tag, sub, child_tag)
            out.append("<li>%s%s</li>\n" % (md_inline(" ".join(texts)), nested))
        return "".join(out), idx

    tag = "ol" if items[0][1] else "ul"
    body, _ = build(0, items[0][0])
    return "<%s>\n%s</%s>\n" % (tag, body, tag)


def render(text, ctx=None, level=1):
    """返回 (html, toc)。level 为起始标题层级偏移（文章正文从 1 起，`#` 映射为 h2）。"""
    ctx = ctx or R.Ctx()
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    n = len(lines)
    out = []
    i = 0
    while i < n:
        line = lines[i]
        if not line.strip():
            i += 1
            continue

        m = re.match(r"^(```+|~~~+)\s*(\S*)\s*$", line)
        if m:
            fence, lang = m.group(1), m.group(2)
            i += 1
            buf = []
            while i < n and not lines[i].startswith(fence[:3]):
                buf.append(lines[i])
                i += 1
            i += 1
            out.append(R.code_block(lang, "\n".join(buf)))
            continue

        m = re.match(r"^:::(note|tip|warn|warning)\s*(.*)$", line)
        if m:
            kind = {"warning": "warn"}.get(m.group(1), m.group(1))
            title = m.group(2).strip()
            i += 1
            buf = []
            while i < n and not lines[i].strip().startswith(":::"):
                buf.append(lines[i])
                i += 1
            i += 1
            inner, _ = render("\n".join(buf), ctx, level)
            head = '<p class="adm-title">%s</p>\n' % md_inline(title) if title else ""
            out.append('<aside class="admonition %s">%s%s</aside>\n' % (kind, head, inner))
            continue

        m = re.match(r"^:::panel\s+(.+)$", line)
        if m:
            title = m.group(1).strip()
            i += 1
            buf = []
            while i < n and not lines[i].strip().startswith(":::"):
                buf.append(lines[i])
                i += 1
            i += 1
            inner, _ = render("\n".join(buf), ctx, level)
            head = '<p class="panel-t">%s</p>\n' % md_inline(title)
            out.append('<aside class="panel">%s%s</aside>\n' % (head, inner))
            continue

        m = re.match(r"^:::steps\s*$", line)
        if m:
            i += 1
            buf = []
            while i < n and not lines[i].strip().startswith(":::"):
                buf.append(lines[i])
                i += 1
            i += 1
            # steps 内部直接解析为 <li>，外层 <ol class="steps">，不再套一层 <ol>/<ul>
            items = []
            for sl in buf:
                s = sl.strip()
                if not s:
                    continue
                mm = re.match(r"^(\d+[.)]|[-*+])\s+(.*)$", s)
                text = mm.group(2) if mm else s
                items.append("<li>%s</li>\n" % md_inline(text))
            out.append('<ol class="steps">\n%s</ol>\n' % "".join(items))
            continue

        m = re.match(r"^:::(shot|gallery|term|when)\s*(.*)$", line)
        if m:
            block_type = m.group(1)
            param = m.group(2).strip()
            i += 1
            buf = []
            while i < n and not lines[i].strip().startswith(":::"):
                buf.append(lines[i])
                i += 1
            i += 1

            if block_type == "shot":
                full = "full" in param
                img_line = buf[0].strip() if buf else ""
                img_match = re.match(r"^!\[([^\]]*)\]\(([^)\s]+)(?:\s+\"([^\"]*)\")?\)\s*$", img_line)
                if img_match:
                    alt, src, caption = img_match.groups()
                    caption = caption or ""
                    img = '<img src="%s" alt="%s" loading="lazy">' % (R.esc(src), R.esc(alt))
                    open_tag = '<figure class="full">' if full else "<figure>"
                    if caption:
                        out.append("%s\n%s<figcaption>%s</figcaption>\n</figure>\n"
                                   % (open_tag, img, md_inline(caption)))
                    else:
                        out.append("%s\n%s\n</figure>\n" % (open_tag, img))
                else:
                    # 非图片语法：降级为普通段落 + 告警；页面里不出现「错误：」文案
                    print("警告：shot 块内容不是图片语法，已降级为普通段落：%r" % img_line,
                          file=sys.stderr)
                    inner, _ = render("\n".join(buf), ctx, level)
                    out.append(inner)
                continue

            if block_type == "gallery":
                cols = "1"
                if re.match(r"^\d+$", param):
                    cols = param
                elif not param:
                    cols = "2"
                img_lines = [l.strip() for l in buf if l.strip()]
                figs = []
                for img_line in img_lines:
                    img_match = re.match(r"^!\[([^\]]*)\]\(([^)\s]+)(?:\s+\"([^\"]*)\")?\)\s*$", img_line)
                    if img_match:
                        alt, src, caption = img_match.groups()
                        caption = caption or ""
                        img = '<img src="%s" alt="%s" loading="lazy">' % (R.esc(src), R.esc(alt))
                        if caption:
                            figs.append('<figure>%s<figcaption>%s</figcaption></figure>\n'
                                        % (img, md_inline(caption)))
                        else:
                            figs.append('<figure>%s</figure>\n' % img)
                    else:
                        print("警告：gallery 跳过非图片行：%r" % img_line, file=sys.stderr)
                if not figs:
                    # 空图集：不输出空 div、不留垃圾，仅告警
                    print("警告：gallery 没有可用图片，已跳过空图集", file=sys.stderr)
                else:
                    out.append('<div class="gallery cols-%s">\n%s</div>\n' % (cols, "".join(figs)))
                continue

            if block_type == "term":
                # 逐行原样保留，用 <br> 连接；内部不得出现 <p>
                inner = "<br>\n".join(R.esc(line) for line in buf)
                out.append('<div class="term">\n%s\n</div>\n' % inner)
                continue

            if block_type == "when":
                param_s = param.strip()
                date_match = re.match(r"^(\d{4}-\d{2}-\d{2})\s+(.+)$", param_s)
                if date_match:
                    date = date_match.group(1)
                    text = date_match.group(2).strip()
                elif re.match(r"^\d{4}-\d{2}-\d{2}$", param_s):
                    date = param_s
                    # 围栏头只有日期：事件正文取围栏头之后的正文（与 SML 的 text 字段对齐）
                    text = "\n".join(l.rstrip() for l in buf if l.strip())
                else:
                    date = ""
                    text = param_s
                if date:
                    out.append('<li class="when">\n<span class="when-t">%s</span>\n%s\n</li>\n'
                               % (md_inline(date), md_inline(text)))
                else:
                    out.append('<li class="when">\n%s\n</li>\n' % md_inline(text))
                continue

        m = re.match(r"^(#{1,6})\s+(.*?)\s*#*\s*$", line)
        if m:
            lv = min(level + len(m.group(1)), 6)
            title = m.group(2).strip()
            ident = R.slugify(re.sub(r"[`*_]", "", title), ctx.used)
            ctx.toc.append({"id": ident, "text": title, "level": lv})
            out.append('<h%d id="%s">%s</h%d>\n' % (lv, R.esc(ident), md_inline(title), lv))
            i += 1
            continue

        if re.match(r"^\s*([-*_])\s*\1\s*\1[\s\-*_]*$", line):
            out.append("<hr>\n")
            i += 1
            continue

        if "|" in line and i + 1 < n and re.match(r"^\s*\|?[\s:|-]+\|[\s:|-]*$", lines[i + 1]):
            rows = []
            j = i
            while j < n and "|" in lines[j] and lines[j].strip():
                rows.append(lines[j])
                j += 1
            head = [c.strip() for c in rows[0].strip().strip("|").split("|")]
            body_rows = [[c.strip() for c in r.strip().strip("|").split("|")] for r in rows[2:]]
            t = ["<table>\n<thead><tr>"]
            t += ["<th>%s</th>" % md_inline(c) for c in head]
            t.append("</tr></thead>\n<tbody>\n")
            for r in body_rows:
                t.append("<tr>" + "".join("<td>%s</td>" % md_inline(c) for c in r) + "</tr>\n")
            t.append("</tbody>\n</table>\n")
            out.append("".join(t))
            i = j
            continue

        if line.lstrip().startswith(">"):
            buf = []
            while i < n and (lines[i].lstrip().startswith(">") or (buf and lines[i].strip())):
                buf.append(re.sub(r"^\s*>\s?", "", lines[i]))
                i += 1
            inner, _ = render("\n".join(buf), ctx, level)
            out.append("<blockquote>\n%s</blockquote>\n" % inner)
            continue

        if re.match(r"^(\s*)([-*+]|\d+[.)])\s+", line):
            buf = []
            while i < n and (re.match(r"^(\s*)([-*+]|\d+[.)])\s+", lines[i]) or lines[i].strip()):
                buf.append(lines[i])
                i += 1
            out.append(_list_html(buf, ctx))
            continue

        if re.match(r"^(\t| {4,})\S", line):
            buf = []
            while i < n and (lines[i].strip() == "" or re.match(r"^(\t| {4,})", lines[i])):
                buf.append(lines[i][4:] if lines[i].startswith("    ") else lines[i].lstrip("\t"))
                i += 1
            out.append(R.code_block("", "\n".join(buf).rstrip()))
            continue

        buf = [line]
        i += 1
        while i < n and lines[i].strip() and not re.match(
                r"^(#{1,6}\s|```|~~~|>|\s*([-*+]|\d+[.)])\s|\s*\|)", lines[i]) and not re.match(
                r"^\s*([-*_])\s*\1\s*\1", lines[i]):
            buf.append(lines[i])
            i += 1
        text_block = "\n".join(buf).strip()
        if text_block.startswith("$$") and text_block.endswith("$$") and len(text_block) > 4:
            out.append(R.math_block(text_block[2:-2].strip()))
            continue
        bv = BV_RE.match(text_block)
        if bv:
            embed = R.video_embed(bv.group(1))
            if embed:
                out.append(embed)
                continue
        out.append("<p>%s</p>\n" % md_inline(text_block))
    return "".join(out), ctx.toc
