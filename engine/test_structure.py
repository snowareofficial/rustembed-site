#!/usr/bin/env python3
"""前端结构断言（新增）：对 dist/ 产物做静态结构与样式不变量检查。

    python engine/test_structure.py

断言只增不减。覆盖：
  A 三栏存在性（左=本文导航 / 中=内容 / 右=站点导航）
  B 左栏含「本文目录」且不含任何站点级入口
  C 右栏默认收起（<details> 无 open）且含 site.nav 的全部分入口
  D 中栏宽度 ≤ 38rem（--measure 令牌 + .col-main 用它做 max-width）
  E 375px 不横向滚动（html overflow-x、出血图、代码块/表格只内部横滚）
  F 首屏不是空白（构建期写入站名 + 最近文章列表）
  G 零外部请求 / 无 Web 字体 / 投稿文本走文本节点
"""

import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import config  # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass

DIST = config.OUT
fails = []
checks = 0


def need(cond, msg):
    global checks
    checks += 1
    if not cond:
        fails.append(msg)
    return bool(cond)


class Skeleton(HTMLParser):
    """极小结构收集器：按 id 取节点，并聚合其文本与所有后代 <a href>。"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.by_id = {}
        self.all = []

    def _open(self, tag, attrs):
        d = {"tag": tag, "attrs": dict(attrs), "text": "", "links": []}
        href = d["attrs"].get("href")
        if tag == "a" and href:
            d["links"].append(href)
        self.stack.append(d)
        self.all.append(d)
        ident = d["attrs"].get("id")
        if ident:
            self.by_id[ident] = d
        return d

    def handle_starttag(self, tag, attrs):
        self._open(tag, attrs)

    def handle_startendtag(self, tag, attrs):
        d = self._open(tag, attrs)
        self.handle_endtag(tag) if False else None
        self.stack.remove(d)

    def handle_endtag(self, tag):
        for k in range(len(self.stack) - 1, -1, -1):
            if self.stack[k]["tag"] == tag:
                node = self.stack[k]
                del self.stack[k:]
                if self.stack:
                    self.stack[-1]["text"] += node["text"]
                    self.stack[-1]["links"].extend(node["links"])
                return
        # 无对应开标签（如 </br>）：忽略

    def handle_data(self, data):
        if self.stack:
            self.stack[-1]["text"] += data


need(DIST.exists(), "dist/ 不存在，先跑 python engine/build.py")
if not DIST.exists():
    print("\n".join(fails))
    sys.exit(1)

html = (DIST / "index.html").read_text(encoding="utf-8")
css = (DIST / "style.css").read_text(encoding="utf-8")
js = (DIST / "app.js").read_text(encoding="utf-8")
man = json.loads((DIST / "manifest.json").read_text(encoding="utf-8"))
nav = man["site"]["nav"]

sk = Skeleton()
sk.feed(html)

# ---- A 三栏存在性 ----
left = sk.by_id.get("col-left")
main = sk.by_id.get("main")
right = sk.by_id.get("col-right")
need(left is not None, "缺少 #col-left（左栏：本文导航）")
need(main is not None, "缺少 #main（中栏：内容）")
need(right is not None, "缺少 #col-right（右栏：站点导航）")
need(left and "col-left" in (left["attrs"].get("class") or ""), "#col-left 缺少 col-left 类")
need(main and "col-main" in (main["attrs"].get("class") or ""), "#main 缺少 col-main 类")
need(right and "col-right" in (right["attrs"].get("class") or ""), "#col-right 缺少 col-right 类")

# ---- B 左栏只有本文导航 ----
need(left and "本文目录" in left["text"], "左栏缺少「本文目录」")
need(left and "章节导图" in left["text"], "左栏缺少「章节导图」入口")
site_hrefs = ["#/" + k for k in nav]
bad = [h for h in (left["links"] if left else []) if h in site_hrefs]
need(not bad, "左栏出现站点级入口：%s" % " ".join(bad))
def inpage(href):
    """左栏只允许「本文导航」链接：页内锚点 / 本篇的导图 SVG。"""
    return href.startswith("#") or href.endswith(".svg")


need(not (left and any(not inpage(h) for h in left["links"])),
     "左栏出现非本文导航链接：%s" % " ".join(h for h in (left["links"] if left else []) if not inpage(h)))

# ---- C 右栏：默认收起 + 全部分入口 ----
drawer = sk.by_id.get("nav-drawer")
need(drawer is not None, "缺少 #nav-drawer")
need(drawer and drawer["tag"] == "details", "右栏导航不是 <details>（键盘可达要求）")
need(drawer and "open" not in drawer["attrs"], "右栏导航默认不是收起状态（多了 open）")
need(drawer and "nav-drawer" in (drawer["attrs"].get("class") or ""), "#nav-drawer 缺少 nav-drawer 类")
site_nav = sk.by_id.get("site-nav")
need(site_nav is not None, "缺少 #site-nav")
if site_nav:
    hrefs = site_nav["links"]
    need(len(hrefs) == len(nav), "右栏站点入口 %d 个，site.nav 有 %d 项" % (len(hrefs), len(nav)))
    for k in nav:
        need("#/" + k in hrefs, "右栏缺少入口 #/%s" % k)

# ---- D 中栏 ≤ 38rem ----
css_nc = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
m_measure = re.search(r"--measure:\s*([0-9.]+)rem", css_nc)
need(m_measure is not None, "style.css 缺少 --measure 令牌（中栏宽度唯一来源）")
need(m_measure and float(m_measure.group(1)) <= 38.0,
     "--measure = %srem，应 ≤ 38rem" % (m_measure.group(1) if m_measure else "?"))
need(re.search(r"\.col-main\s*\{[^}]*max-width:\s*var\(--measure\)", css_nc) is not None,
     ".col-main 没有用 max-width: var(--measure)")
# 网格中栏必须是可伸缩的 1fr：宽度约束交给 .col-main 的 max-width，
# 这样「数据型页面放宽 --measure」才不会把三栏挤爆。
need(re.search(r"grid-template-columns:[^;]*minmax\(0,\s*1fr\)", css_nc) is not None,
     "三栏网格的中栏应为 minmax(0, 1fr)（宽度由 .col-main 的 max-width 控制）")
# 高 DPI 笔记本（CSS 宽常 1040–1439）也要保持三栏，否则 150% 缩放下左栏会整块消失
need(re.search(r"@media\s*\(min-width:\s*1040px\)\s*and\s*\(max-width:\s*1439px\)", css_nc) is not None,
     "缺少 1040–1439px 的三栏断点（高 DPI 屏幕会退化成单栏）")

# ---- E 375px 不横向滚动 ----
need(re.search(r"html\s*\{[^}]*overflow-x:\s*clip", css_nc) is not None,
     "html 缺少 overflow-x: clip（出血元素会产生横向滚动条）")
need(re.search(r"figure\.full\s*img[^{]*\{[^}]*width:\s*100vw", css_nc) is not None,
     "破栏出血图片没有写成 width: 100vw")
need(re.search(r"figure\.full\s*img[^{]*\{[^}]*max-width:\s*none", css_nc) is not None,
     "破栏出血图片没有 max-width: none（会被容器二次撑宽）")
need(re.search(r"\.code\s+pre\s*\{[^}]*overflow-x:\s*auto", css_nc) is not None,
     ".code pre 缺少 overflow-x: auto（代码块会撑破页面）")
tbl = re.search(r"\.col-main\s+table\s*\{(.*?)\}", css_nc, re.S)
need(tbl is not None, "缺少 .col-main table 规则")
if tbl:
    body = tbl.group(1)
    need("overflow-x: auto" in body, "table 缺少 overflow-x: auto（表格会撑破页面）")
    need("max-width: 100%" in body, "table 缺少 max-width: 100%")
need(re.search(r"\.col-main\s+th,\s*\.col-main\s+td\s*\{[^}]*white-space:\s*normal", css_nc) is not None,
     "表格单元格不应 white-space: nowrap")
need(not re.search(r"table[^{]*\{[^}]*width:\s*max-content", css_nc),
     "表格用了 width: max-content（桌面端会被撑出屏幕）")
need(re.search(r"@media\s*\(max-width:\s*1039px\)", css_nc) is not None,
     "缺少 ≤1039px 的窄屏断点")
narrow = css_nc.split("@media (max-width: 1039px)")[-1]
need(re.search(r"\.col-left\s*\{\s*display:\s*none", narrow) is not None, "窄屏没有隐藏左栏")
need(re.search(r"\.mobile-toc\s*\{[^}]*display:\s*block", narrow) is not None,
     "窄屏没有显示内容顶部的「本页目录」折叠条")
need(re.search(r'<details[^>]*class="mobile-toc"', html) is not None,
     "index.html 缺少 <details class=\"mobile-toc\">（窄屏本页目录）")

# ---- F 首屏不是空白 ----
need("<!--BUILD:FIRST-->" not in html, "index.html 的静态首屏占位没被替换")
need(man["site"]["title"] in html, "首屏静态 HTML 里没有站名")
first_posts = [p for p in man["posts"] if "#/post/" + p["slug"] in html]
need(len(first_posts) >= 1, "首屏静态 HTML 里没有最近文章链接")
need(len(first_posts) <= 8, "首屏静态文章超过 8 条（每屏 6–8 行）")
need('id="view"' in html, "index.html 缺少 #view（JS 接管容器）")

# ---- G 自托管字体（MiSans 子集）/ 零外部请求 / 文本节点 ----
need(not re.search(r'src\s*=\s*["\']https?://', html), "index.html 里有外部 src（零外部请求要求）")
need(not re.search(r'href\s*=\s*["\']https?://', html), "index.html 里有外部 href（零外部请求要求）")
# 字体必须是「本地子集」：@font-face 只在 dist/fonts.css 里，style.css 不写 face、也不引外部字体
need("@font-face" not in css_nc, "style.css 里出现 @font-face（字体声明应集中在 fonts.css）")
need('href="fonts.css"' in html, "index.html 没有引用 fonts.css（自托管字体子集没接上）")
need(re.search(r"font-family:\s*[\"']MiSans[\"']", css_nc) is not None,
     "正文字体栈没有把 MiSans 放在首位（不同系统会显示不同字体）")
fonts_css = DIST / "fonts.css"
need(fonts_css.exists(), "dist/fonts.css 不存在（字体子集没生成）")
if fonts_css.exists():
    fc = fonts_css.read_text(encoding="utf-8")
    need("@font-face" in fc, "fonts.css 里没有 @font-face")
    need("url('fonts/" in fc or 'url("fonts/' in fc, "fonts.css 没有指向本地 fonts/ 目录")
    need(not re.search(r"https?://", fc), "fonts.css 里出现外部 URL（字体必须自托管）")
subset = sorted((DIST / "fonts").glob("*.woff2")) + sorted((DIST / "fonts").glob("*.woff"))
need(len(subset) >= 1, "dist/fonts/ 里没有字体子集文件")
need(sum(p.stat().st_size for p in subset) < 600 * 1024,
     "字体子集合计 %.0f KB，超过 600 KB（子集化没生效？）" % (sum(p.stat().st_size for p in subset) / 1024))
need((DIST / "fonts" / "LICENSE-MiSans.txt").exists(), "字体许可文件没有随产物发布")
need(not re.search(r"\.woff2?['\"]?\s*\)\s*;?[^}]*https?://", fc), "fonts.css 引用了外部字体")
need("cdn." not in js and "http://" not in js.replace("https?://", "").replace("http://www.w3.org", ""),
     "app.js 里出现外部地址")
js_code = re.sub(r"/\*.*?\*/", "", js, flags=re.S)
js_code = re.sub(r"(^|[^:\\])//[^\n]*", r"\1", js_code)
need("childNodes.length" not in js_code, "app.js 代码里出现 childNodes.length")
need(len(re.findall(r"\.innerHTML\s*=", js_code)) == 1,
     "app.js 里 innerHTML 赋值不止一处（只允许预渲染片段那一处）")

# ---- H 已修 bug 的回归钉子 ----
# H1 成员卡：技能芯片必须落在文字列，否则会被塞进 3rem 头像列并压住数字行
need(re.search(r"\.person\s*>\s*\.chips\s*\{[^}]*grid-column:\s*2", css_nc) is not None,
     "成员卡的 .chips 没写 grid-column: 2（会与数字行重叠）")
# H2 卡片被拉伸时网格不应均分行高
need(re.search(r"\.person\s*\{[^}]*align-content:\s*start", css_nc) is not None,
     ".person 缺少 align-content: start（卡片会被拉开成空洞）")
# H3 没有分节标题的页面，左栏不占位
need('data-toc' in js_code, "app.js 没有设置 body[data-toc]（无目录页面的左栏不会收起）")
need(re.search(r'body\[data-toc="none"\]\s+\.col-left\s*\{\s*display:\s*none', css_nc) is not None,
     "CSS 缺少 body[data-toc=\"none\"] .col-left 的收起规则")
# H4 页脚署名
need("Powered by" in js_code and "snoware" in js_code, "页脚缺少 Powered by snoware & SML")
# H6 首页：单列居中 + 隐藏右侧站点导航栏（首页自己就是导航页）
need(re.search(r'body\[data-page="home"\]\s+\.col-right\s*\{\s*display:\s*none', css_nc) is not None,
     "首页没有隐藏右侧站点导航栏")
need(re.search(r'body\[data-page="home"\]\s+\.layout\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)',
               css_nc) is not None,
     "首页没有改成单列（应居中且不留侧栏）")
# H5 front matter 数组：逗号与空白两种分隔都要支持（否则 `[ 指南 markdown 投稿 ]` 会变成单个标签）
sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
import markdown as _md  # noqa: E402
need(_md._scalar("[ 指南 markdown 投稿 ]") == ["指南", "markdown", "投稿"],
     "front matter 空格分隔数组没有拆开：%r" % (_md._scalar("[ 指南 markdown 投稿 ]"),))
need(_md._scalar("[ rust, embedded ]") == ["rust", "embedded"],
     "front matter 逗号分隔数组没有拆开")
need(_md._scalar('[ "New York" , "LA" ]') == ["New York", "LA"],
     "front matter 引号内空格被误拆")

print("结构断言 %d 条（三栏 / 左栏纯净 / 右栏收起 / 版心 / 溢出 / 首屏 / 零外链 / 回归钉）" % checks)
if fails:
    print("失败 %d 项：" % len(fails))
    for f in fails:
        print("  - %s" % f)
    sys.exit(1)
print("STRUCTURE PASS")
