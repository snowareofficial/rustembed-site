#!/usr/bin/env python3
"""产物自检：跑完 build.py 后执行，验证关键文件与不变量。

python tools/check.py
"""

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import config  # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass

ROOT = config.SITE
DIST = config.OUT
fails = []


def need(cond, msg):
    if not cond:
        fails.append(msg)


# 合法生成的行内/块级标签，从标签内文本里剔除后再判断是否有「裸」< 或非法 &
_BENIGN = re.compile(
    r"</?(?:strong|em|code|span|a|b|i|u|del|s|dfn|sub|sup|kbd|mark|abbr|q|cite|small)\b[^>]*>"  # 行内标签
    r"|</?figure>|</?figcaption>|<br\s*/?>|<img\b[^>]*>"  # 图片 / 换行
    r"|<svg\b.*?</svg>|<math\b.*?</math>|<!--.*?-->",   # svg / MathML / 注释
    re.I | re.S)


def _unwanted_raw(text):
    """标签内文本里是否存在未转义的裸 < 或非法 &（能真正失败，而非空操作）。"""
    t = _BENIGN.sub("", text)
    if "<" in t:
        return True
    if re.search(r"&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)", t):
        return True
    return False


need(DIST.exists(), "dist/ 不存在，先跑 tools/build.py")
if not DIST.exists():
    print("\n".join(fails))
    sys.exit(1)

for f in ("index.html", "app.js", "style.css", "manifest.json", "search-index.json",
          "sitemap.xml", "feed.xml", "map.svg", "llms.txt", "llms-full.txt"):
    need((DIST / f).exists(), "缺少产物 %s" % f)

man = (DIST / "manifest.json").read_text(encoding="utf-8")
m = json.loads(man)
need(m["site"]["title"], "site.title 为空")
need(m["site"]["url"].startswith("http"), "site.url 非法")
need(m["site"].get("domains"), "site.domains 为空（多域名应配置）")
need(m["site"]["group"].get("join_url"), "site.group.join_url 为空（「加入我们」按钮需要）")
need(m["site"]["nav"], "site.nav 为空（左栏导航需要）")
need(m["site"].get("repo_url"), "site.repo_url 为空（仓库地址应只有这一处数据源）")
_self = [p for p in m["projects"] if p["id"] == "rec-blog"]
if _self and m["site"].get("repo_url"):
    need(_self[0]["repo"].rstrip("/") == m["site"]["repo_url"].rstrip("/"),
         "项目 rec-blog 的 repo 与 site.repo_url 不一致（%s ≠ %s）"
         % (_self[0]["repo"], m["site"]["repo_url"]))
_gen = [p for p in m["projects"] if p["id"] == "sml-sitegen"]
if _gen and m["site"].get("repo_mirror"):
    need(_gen[0]["repo"].rstrip("/") == m["site"]["repo_mirror"].rstrip("/"),
         "项目 sml-sitegen 的 repo 与 site.repo_mirror 不一致（%s ≠ %s）"
         % (_gen[0]["repo"], m["site"]["repo_mirror"]))

idx = (DIST / "index.html").read_text(encoding="utf-8")
need("<!--BUILD:HEAD-->" not in idx, "index.html 里的 <!--BUILD:HEAD--> 占位没被替换")
need('rel="icon"' in idx, "index.html 缺少 favicon（群 logo）链接")
need(m["site"]["avatar"], "site.avatar 为空（群 logo / favicon 来源）")
if m["site"]["avatar"]:
    need((DIST / "favicon.jpg").exists() or (DIST / "favicon.png").exists()
         or (DIST / m["site"]["avatar"]).exists(), "favicon 文件缺失")
need((DIST / "site.webmanifest").exists(), "缺少 site.webmanifest")
if (DIST / "fonts.css").exists():
    need('href="fonts.css"' in idx, "存在 fonts.css 但 index.html 没有引用它")
    need(list((DIST / "fonts").glob("*.woff2")) + list((DIST / "fonts").glob("*.woff")),
         "fonts.css 存在但没有字体子集文件（woff2 / woff）")

for p in m["posts"]:
    need(p["tags"], "文章 %s 没有标签" % p["slug"])
    need((DIST / p["html"]).exists(), "文章片段缺失 %s" % p["html"])
    need((DIST / p["map"]).exists(), "文章导图缺失 %s" % p["map"])
    body = (DIST / p["html"]).read_text(encoding="utf-8")
    need(len(body) > 20, "文章片段过短 %s" % p["slug"])
    need(not re.search(r"\{(ref|term|math|em|strong|link):", body), "文章 %s 有未解析的内联角色" % p["slug"])
    need("<script" not in body.lower(), "文章 %s 片段里出现了 script（投稿内容不应带脚本）" % p["slug"])
    need(not re.search(r"<p>[^<]*(^|\n)\s*#{1,6}\s", body), "文章 %s 疑似有未渲染的 Markdown 标题" % p["slug"])
    need(not re.search(r"<p>[^<]*\*\*", body), "文章 %s 疑似有未渲染的 Markdown 粗体" % p["slug"])
    # 新增块：确保没有未转义的 HTML 特殊字符
    # 检查每个段落、列表项、图注标签内的文本
    for tag in ("p", "li", "figcaption"):
        for text in re.findall(r'<%s>(.*?)</%s>' % (tag, tag), body, re.DOTALL):
            if _unwanted_raw(text):
                fails.append("文章 %s 在 <%s> 标签内发现未转义内容" % (p["slug"], tag))
                break
    # 防回归断言（缺陷 3 / 4）
    need("错误：" not in body, "文章 %s 包含字面量错误：文案" % p["slug"])
    for mg in re.finditer(r'<div class="gallery cols-[^"]*">(.*?)</div>', body, re.DOTALL):
        need("<figure" in mg.group(1), "文章 %s 的 gallery 块缺少 <figure>" % p["slug"])
    for mt in re.finditer(r'<div class="term">(.*?)</div>', body, re.DOTALL):
        need("<p" not in mt.group(1), "文章 %s 在 term 块内发现 <p> 标签" % p["slug"])
    for toc in p["toc"]:
        need(('id="%s"' % toc["id"]) in body, "文章 %s 的章节锚点缺失：%s" % (p["slug"], toc["id"]))

svg = (DIST / "map.svg").read_text(encoding="utf-8")
need(svg.startswith("<svg"), "map.svg 头部异常")
need(svg.count("<a class=") >= 5, "map.svg 可点击节点过少")

for p in m["pages"]:
    need(p.get("group"), "文档页 %s 缺少 group（文档树按 group 分组）" % p["id"])
    need(p.get("order") is not None, "文档页 %s 缺少 order（决定同级顺序）" % p["id"])

for mem in m["members"]:
    src = (ROOT / mem["file"]).read_text(encoding="utf-8")
    if "&" in src and not mem["links"]:
        fails.append("成员 %s 的 links 为空：片段（&引用）可能没展开" % mem["id"])

# 能力与合作黄页不变量：owner 必须存在；contact 只能引用该成员已公开的 links 字段；
# 每条片段都要带免责声明（性质声明：本站只展示，不交易、不担保、不抽成、不经手资金、不介入纠纷）。
member_ids = {x["id"] for x in m["members"]}
for s in m.get("services", []):
    need(s.get("name"), "黄页条目 %s 缺少 name" % s.get("id"))
    need(s.get("owner"), "黄页条目 %s 必须有 owner（成员 id）" % s["id"])
    need(s.get("owner") in member_ids,
         "黄页条目 %s 的 owner `%s` 不在成员档案里（content/members/）" % (s["id"], s.get("owner")))
    need(s.get("status") in ("active", "paused"), "黄页条目 %s 的 status 非法：%s" % (s["id"], s.get("status")))
    need(s.get("contact"), "黄页条目 %s 缺少 contact" % s["id"])
    need((DIST / s["html"]).exists(), "黄页片段缺失 %s" % s["html"])
    need((DIST / s["map"]).exists(), "黄页导图缺失 %s" % s["map"])
    body = (DIST / s["html"]).read_text(encoding="utf-8")
    need("不参与交易" in body and "不担保" in body and "不抽成" in body
         and "不经手资金" in body and "不介入纠纷" in body,
         "黄页片段缺少免责声明（不交易/不担保/不抽成/不经手资金/不介入纠纷）%s" % s["id"])
    need("<script" not in body.lower(), "黄页片段 %s 里出现了 script" % s["id"])
    mem = next((x for x in m["members"] if x["id"] == s.get("owner")), None)
    if mem:
        for c in s.get("contact") or []:
            need(c in (mem.get("links") or {}),
                 "黄页条目 %s 的联系方式 `%s` 不是成员 %s 已公开的 links 字段" % (s["id"], c, mem["id"]))

for d in m["pages"] + m["weekly"]:
    need((DIST / d["html"]).exists(), "片段缺失 %s" % d["html"])
    need((DIST / d["map"]).exists(), "导图缺失 %s" % d["map"])

need(not re.search(r">\s*(None|null|True|False)\s*<", man), "manifest 里疑似出现裸 Python 值")
need("__type" not in man, "manifest 里泄漏了解析器内部字段 __type（片段展开未清理）")
need("__is" not in man and "__contracts" not in man and "__md_body" not in man,
     "manifest 里泄漏了解析器内部字段（__is / __contracts / __md_body）")

contracts_page = [p for p in m["pages"] if p["id"] == "contracts"]
need(contracts_page, "缺少自动生成的契约文档页（content/contracts/*.sml 是否为空？）")
if contracts_page:
    need((DIST / contracts_page[0]["html"]).exists(), "契约文档页片段缺失")
    need((DIST / contracts_page[0]["map"]).exists(), "契约文档页导图缺失")
    body = (DIST / contracts_page[0]["html"]).read_text(encoding="utf-8")
    need(body.count("<table>") >= 1, "契约文档页没有表格")
    need("E-CONTRACT" not in body, "契约文档页里出现了错误码字样（说明契约本身有问题）")
    # 契约名是自由文本，会被拼进 id 属性与导图；这里把转义失效变成硬失败。
    # 只查「有没有形成标签」：事件属性必须依附标签，所以标签检查已足够；
    # 单查 on*= 会在正文合法提到 "onerror=" 这类字样时误报。
    need(not re.search(r"<(script|img|svg|iframe|object|embed)\b", body, re.I),
         "契约文档页出现裸标签（契约名未转义？）")

print("文章 %d / 项目 %d / 成员 %d / 资源 %d / 周报 %d / 文档 %d / 黄页 %d"
      % (len(m["posts"]), len(m["projects"]), len(m["members"]),
         len(m["resources"]), len(m["weekly"]), len(m["pages"]),
         len(m.get("services", []))))

# 构建期产生的告警（gallery 形状非法等）持久化在 dist/build-warnings.json，
# 这里复核并显式呈现：仅提示、不影响 ALL PASS（告警不阻断发布）。
_warn_file = DIST / "build-warnings.json"
if _warn_file.exists():
    try:
        _warns = json.loads(_warn_file.read_text(encoding="utf-8"))
    except Exception:                       # noqa: BLE001
        _warns = []
    if _warns:
        print("构建告警（%d 条，构建期产生，不阻断发布）：" % len(_warns))
        for _w in _warns:
            print("  [warn] %s" % _w)

if fails:
    print("失败 %d 项：" % len(fails))
    for f in fails:
        print("  - %s" % f)
    sys.exit(1)
print("ALL PASS")
