# 给 hy3 的 i18n phase 1 提示词（文章多语言，posts only）

> 基线：`628331c`。与 hy4 的 M3 **并行**，文件所有权必须严格分开。
> 本任务只做「文章内容多语言」，不翻译 UI、不改目录结构。

```text
在 rec-blog 做「文章多语言 phase 1」。仓库根目录：C:\Users\sakeen\Desktop\rec-blog
先确认 HEAD 是 628331c 或更新；不要 rebase/force。
先读：AGENTS.md、docs/ARCHITECTURE.md、engine/build.py（posts 循环与 manifest 写入）、
site/theme/app.js（viewPost 路由与渲染）、site/content/posts/2026/cortex-m-bringup/index.md。

# 文件所有权（hy4 正在并行做 M3）
你只改这些：
  engine/build.py、site/theme/app.js、site/theme/style.css（如需语言切换样式）、
  site/content/posts/**、tests/i18n_test.py、docs/I18N.md
绝对不要改：
  gui/**、engine/gui.py、engine/gui_api.py、tests/gui_api_test.py、
  site/content/site.sml、docs/GUI*.md
遇到必须改上面的情况：停下来，在 docs/I18N.md 写清楚，不要动手。

# 目标（只做 posts）
- 同一篇文章同一目录可放多个语言版本：
    index.md       = zh（默认，URL 不变）
    index.en.md    = en
- 允许的 lang 只有 zh、en（白名单）；
- 路由：
    #/post/<slug>          → zh
    #/post/<slug>?lang=en  → en
- 产物：
    p/<slug>.html          （zh，保持现状）
    p/<slug>.en.html       （en）
- manifest 增加 langs 映射；顶层 posts 字段保持 zh 兼容，不破坏现有前端/搜索。

# 实现步骤（按顺序，每步自测）

1) build.py 发现文件
   - 现有 posts 循环只认 index.(md|sml)；扩展为 index、index.<lang>.(md|sml)；
   - 用正则 ^index(?:\.([a-z]{2}))?\.(md|sml)$，lang 必须在 {zh,en}；
   - 以 (year, slug) 分组；同一组同一 lang 出现两次 → rep.err 并给两个路径；
   - 只允许 site/content/posts/** 下、realpath 不逃逸；符号链接跳过并报错。

2) 逐语言渲染
   - 每个版本独立走现有 load2/契约/渲染/TOC/字数，不共享正文；
   - 默认 zh 产物路径、字段、HTML 与现在完全一致；
   - en 产物写 p/<slug>.en.html，assets 仍用 assets/posts/<slug>/ 共享。

3) manifest
   - 每个 post 增加：
       "default_lang": "zh",
       "langs": {
         "zh": {"html": "p/<slug>.html", "title": ..., "summary": ..., "tags": [...], "words": ...},
         "en": {"html": "p/<slug>.en.html", "title": ..., "summary": ..., "tags": [...], "words": ...}
       }
   - 顶层 title/summary/tags/html 等仍取 zh，保证旧字段可用；
   - 不要输出绝对路径。

4) app.js 路由
   - viewPost 读取 slug 后的 ?lang=；解析失败/不在 langs → 回落 default_lang，不做跳转；
   - 用对应 variant 的 html/title/summary/tags/words 渲染；
   - document.documentElement.lang = lang；
   - langs 数量 >1 时在标题附近显示语言切换（zh / en），切换只改 query，保持当前滚动位置；
   - 现有不带 ?lang= 的行为必须完全不变。

5) 安全
   - lang 只来自白名单；<html lang>、链接参数、切换按钮的 href 都要转义；
   - 除 lang 外不接受任意 query 影响文件路径；
   - 不新增 innerHTML 拼接未转义字段；沿用现有 esc/textContent。

# 测试（新增 tests/i18n_test.py，标准库）

- 单语言文章：manifest 无 langs 或只有 zh，构建产物与改动前一致；
- 给 cortex-m-bringup 加一个临时 index.en.md：
    build 后存在 p/<slug>.en.html；manifest langs.en.title 正确；
    GET 静态文件 200；
- 非法 lang：?lang=fr / ?lang=../x / ?lang=javascript: → 回落 zh，不越界；
- 同 slug 两个 zh（index.md + index.zh.md）→ 构建失败并报路径；
- 同 slug 两个 en → 构建失败；
- 符号链接逃逸 → 拒绝；
- 默认路由输出与旧 manifest 字段逐项一致（防回归）。
测试用临时站点目录，不要改真实 site/content；如需英文样稿，复制现有英文文章到临时目录。

# 验收

python engine/test_contracts.py
python engine/test_render_safety.py
python engine/test_structure.py
python tests/i18n_test.py
python engine/cli.py build --offline
python engine/cli.py check

人工：
- 打开 #/post/cortex-m-bringup → 中文；
- 打开 #/post/cortex-m-bringup?lang=en → 英文标题/摘要/正文；
- 语言切换不刷新页面、不丢滚动；
- 现有中文文章 URL/内容不变。

# 非目标（不要做）

- 不翻译 UI 文案（导航/按钮/错误/空状态）；
- 不建 zh/ en/ 子目录，不改现有 URL；
- 不做 pages/topics/weekly/resources 的多语言；
- 不改 feed/sitemap（只列默认语言，文档说明即可）；
- 不改 GUI（hy4 的 M3）；
- 不做静态 SEO 多语言页（当前是 hash SPA）。

# 交付

- 代码 + tests/i18n_test.py + docs/I18N.md（文件命名、manifest 形状、路由、限制）；
- 每步 commit（feat(engine)/feat(site)/test(i18n)/docs(i18n)）；
- 本地提交、不 push、不 force；最终贴验收输出。
```

给 hy3 的额外提醒：

- 先只跑**单语言回归**，确认旧产物零变化，再加 en 分支；
- 不确定 `docs_in()` 的行为就先打印它返回的文件列表，不要凭猜；
- 遇到 `app.js` 路由复杂，先只支持 `?lang=` 的读取与默认回退，语言切换按钮可以最后加。
