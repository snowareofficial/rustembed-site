"""内容读取与渲染出口：SML / Markdown 两种正文统一入口。

只做「文件 → 数据 / HTML」，不认识 manifest、不落盘；各内容类型模块
（posts / projects / members …）都从这里取。
"""

from engine.core import content_paths
from engine.core.content_paths import docs_in  # noqa: F401 —— 各内容模块共用的发现函数
from engine.core.paths import CONTENT, REQ
from engine.parse import sml
from engine.render import markdown as md
from engine.render import render


def _strip_bom(text):
    """去掉 UTF-8 BOM：native 后端容忍、builtin 后端不容忍，必须统一。"""
    return text[1:] if text.startswith("\ufeff") else text


def load(path):
    """按扩展名分发：.sml 走 SML 解析器，.md/.markdown 取 front matter（正文放 __md_body）。"""
    if path.suffix.lower() in (".md", ".markdown"):
        meta, body = md.split_front_matter(path.read_text(encoding="utf-8"))
        meta["__md_body"] = body
        return meta
    return sml.load(path)


def load2(f):
    """读内容文件：返回 (数据, 文件内契约表)。

    `.sml` 走文件入口：native 展开 include，root = CONTENT（site/content）——
    跨目录（如 resources/ → contracts/）也能包含，越界则拒。
    """
    if f.suffix.lower() in (".md", ".markdown"):
        meta, body = md.split_front_matter(f.read_text(encoding="utf-8"))
        meta["__md_body"] = body
        return meta, {}
    return sml.load_doc(str(f), root=str(CONTENT))


def render_body(d, ctx, level=1, rep=None, where=""):
    """SML body / Markdown body 统一出口，返回 (html, toc)。

    渲染期产生的告警（如 gallery 子块形状非法）收集在 ctx.warnings，
    若传入 rep/where 则登记进构建报告；仅告警、不阻断构建。
    """
    body = d.get("__md_body")
    if body is not None:
        html, toc = md.render(body, ctx, level)
    else:
        html = render.render(pick(d, ["body", "children"], []), ctx, level)
        toc = ctx.toc
    if rep is not None and where:
        for w in getattr(ctx, "warnings", []):
            rep.warn(where, w)
        ctx.warnings = []
    return html, toc


def as_list(v):
    return sml.as_list(v)


def uniq_str(v):
    """去重后的字符串列表（顺序不变）：用于 related_series / related_posts 这类
    引用型字段 —— 重复引用只会让前端多一次无意义的查找。"""
    out = []
    for x in as_list(v):
        s = sml.as_str(x)
        if s and s not in out:
            out.append(s)
    return out


def pick(d, keys, default=None):
    for k in keys:
        v = d.get(k)
        if v not in (None, "", []):
            return v
    return default


def check_req(rep, kind, where, data):
    for k in REQ.get(kind, []):
        if data.get(k) in (None, "", []):
            rep.err(where, "缺少必填字段 `%s`" % k)


def where_of(f):
    """内容文件 → 报告里用的仓库相对路径。"""
    from engine.core.paths import ROOT
    return f.relative_to(ROOT).as_posix()


__all__ = ["load", "load2", "docs_in", "render_body", "as_list", "uniq_str", "pick",
           "check_req", "where_of", "content_paths"]
