# 文件结构 · git 写作流程 · 全链路

面向两类人：**第一次投稿的群友**（只想写一篇）和**维护站点的人**（要改前端/引擎/发布）。
所有命令都在仓库根目录执行，Python 3.8+（CI 用 3.11），不需要 Node（前端零构建；`tests/browser-check.js` 才需要 Node）。

---

## 1. 文件结构（改哪里）

```
rec-blog/
├─ engine/                    构建器（可整体复制给别的站点）
│  ├─ cli.py                  唯一入口：new/list/assets/gen/contracts/build/check/test/preview
│  ├─ build.py                渲染 + 契约校验 + 产物（manifest/片段/摘要/字体/RSS/llms/_headers）
│  ├─ check.py                产物自检
│  ├─ preview.py              本地静态服务（带 charset，后台运行）
│  ├─ config.py               站点路径解析（--site）
│  ├─ fonts_import.py         从 MiSans.zip 挑权重到 site/fonts/src
│  ├─ ai_summarize.py         构建期 AI 摘要（OpenAI 兼容网关 → summaries/<slug>.json）
│  ├─ git_ready.py            入库前检查；--commit 可本地提交（不 push）
│  ├─ gui.py gui_api.py       写作台 API（GUI 任务用，见 docs/GUI.md）
│  ├─ native/                 SML 原生后端 sml.dll（gitignore；没有就回退内置解析器）
│  ├─ test_contracts.py       契约引擎自测（21 项）
│  ├─ test_render_safety.py   渲染安全回归（182 条）
│  ├─ test_structure.py       产物结构断言（88 条）
│  ├─ verify_parity.py        Markdown ↔ SML 渲染一致性证据
│  ├─ lib/                    sml / markdown / render / contract / mindmap / repo_meta /
│  │                          mathml / summary / urls / _swsml
│  ├─ prompts/summarize.md    AI 摘要的输入输出约定（构建期离线步骤用）
│  └─ vendor/                 vendored fontTools 与 latex2mathml（不是 pip 依赖）
│
├─ gui/                       写作台（Rust 启动器 + 内嵌 Web UI；cargo install rec-blog-gui）
├─ Cargo.toml / Cargo.lock    Rust workspace（members=["gui"]）
├─ Dockerfile                 自托管构建器镜像
│
├─ site/                      本站点（内容都在这里）
│  ├─ content/
│  │  ├─ site.sml             站名/导航/群信息/公告/群规/大事记/契约默认映射
│  │  ├─ posts/<年>/<短名>/    文章：index.md 或 index.sml + assets/（图片）
│  │  ├─ pages/*.sml          站文档（投稿指南、写作速查、附件规则、制度…）
│  │  ├─ topics/*.(md|sml)    主题词条（同标签文章自动归入）
│  │  ├─ members/<id>.sml     成员档案（同目录 <id>.jpg 自动当头像）
│  │  ├─ services/<id>.sml    能力与合作黄页（纯展示）
│  │  ├─ projects/<id>.sml    项目（构建期抓仓库元数据）
│  │  ├─ resources/<id>.sml   资源库
│  │  ├─ weekly/<期>.sml      周报
│  │  ├─ summaries/<slug>.json  可选：AI 摘要产物（有就用，没有退回抽取式）
│  │  └─ contracts/*.sml      内容契约（字段即文档；改契约=改校验=改契约页）
│  ├─ theme/                  index.html / app.js / style.css（hash 路由 SPA，零构建）
│  ├─ fonts/                  src/ 与 subset/ 均 gitignore；CI 解密加密包（FONT_PASSWORD）再子集化
│  └─ meta/repos.json         仓库元数据缓存（入库）
│
├─ tests/                     前端验收（Node）
│  ├─ smoke.js                路由的 DOM 冒烟
│  ├─ browser-check.js        无头 Edge 检查：布局/溢出/对比度/摘要/导图拖动
│  ├─ dom-stub.js             DOM 桩（跑 app.js 视图用）
│  └─ gui_api_test.py         写作台 API 回归（Python 标准库，起真实服务）
│
├─ deploy/                    自托管：entrypoint / build / rebuild / gitee-webhook / fonts-crypt
├─ docs/                      ARCHITECTURE / DEPLOY / FONTS / GOVERNANCE / ROADMAP / SELF-HOST /
│                             GUI / WORKFLOW（本文）
├─ .github/workflows/         build.yml（校验门禁）、publish-pages.yml（构建+发布）、
│                             sync-from-gitee.yml（镜像）
├─ dist/                      构建产物（gitignore）
└─ CONTRIBUTING.md / README.md
```

> 一句话：**只写文章 → 只看 `site/content/posts/`**；改页面样式 → `site/theme/`；改字段规则 → `site/content/contracts/`；改构建逻辑 → `engine/`。

---

## 2. git 写作流程（投稿）

### 2.1 准备

```bash
git clone https://gitee.com/rustembed/site.git
cd site
python --version          # 3.8+；无需 pip 安装任何东西
```

### 2.2 建骨架（推荐）

```bash
python engine/cli.py new "全链路演示" --slug demo-chain --tags demo --author sal
# → content/posts/2026/demo-chain/index.md
```

- `--sml` 生成 SML 版；`--topic` 建词条；`--series` 加系列
- 也可以手写：`site/content/posts/<年份>/<英文短名>/index.md`（短名只用小写字母/数字/连字符）

### 2.3 填 front matter（Markdown 版）

```markdown
---
title: "全链路演示"
author: sal            # 必须是 site/content/members/<id>.sml 里的 id
date: 2026-10-18
tags: [demo, chain]    # 逗号或空格分隔都行
summary: "一句话摘要（列表页与分享卡片用）"
# 可选字段：
updated: 2026-10-19
license: CC BY-NC-SA 4.0
map: true              # 开章节导图（默认关；开了弹层里可拖动/缩放）
video: BV1GJ411x7h7    # B 站 BV 号（点击后才加载播放器，零第三方请求）
series: rust-embedded-101
order: 1
draft: false
co_authors: [cxi]
attachments:
  - { name: 示例工程, kind: link, url: https://gitee.com/..., size: — }
---
```

字段全集与约束以 `site/content/contracts/blog.sml` 为准（终端里 `python engine/cli.py contracts` 可直接看）。

### 2.4 写正文

- 标题：`## 一级小节`、`### 二级`（决定左栏目录与导图）
- 代码块、表格、引用、列表都支持；图片放同目录 `assets/`，正文写 `![](assets/x.png)`
- 想用结构化块（面板/步骤/图集/词条/提示/代码）见站点「文档 → 写作速查」
- 附件一律卡片化展示，下载渠道自动识别（蓝奏云 / 阿里云盘 / 夸克 / Gitee…）

### 2.5 本地验证（四连）

```bash
python engine/cli.py test      # 契约自测（21 项）
python engine/cli.py build     # 构建 + 字段校验 + 字体子集 + RSS/llms
python engine/cli.py check     # 产物自检
python engine/cli.py preview   # http://127.0.0.1:8080/
```

浏览器里打开 `http://127.0.0.1:8080/#/post/<短名>` 自查：标题、目录、代码复制、图片、附件卡。

### 2.6 提交与 PR

```bash
git checkout -b post/demo-chain
git add site/content/posts/2026/demo-chain
git commit -m "post: 全链路演示（Markdown）"
git push origin post/demo-chain
```

PR 模板在 `.github/PULL_REQUEST_TEMPLATE.md`；合并前审稿人看：事实、字段齐、附件合规（详见站点「制度 → 创作与审稿」）。

---

## 3. 全链路（已实测）

| 阶段 | 命令 | 产物 / 结果 |
|---|---|---|
| 建骨架 | `cli.py new` | `site/content/posts/2026/demo-chain/index.md` |
| 构建 | `cli.py build --offline` | `dist/manifest.json`、`dist/p/<slug>.html`、`dist/summaries/<slug>.json`、`dist/fonts/*.woff`、`feed.xml`、`llms.txt`、`_headers` |
| 契约 | `cli.py test` | `契约自测 ALL PASS（5 个契约，21 项断言）` |
| 产物自检 | `cli.py check` | `ALL PASS`（告警不阻断） |
| 预览 | `cli.py preview` | `http://127.0.0.1:8080/`（`text/html; charset=utf-8`） |
| 前端验收 | `node tests/browser-check.js` | `BROWSER PASS（N 项）` |
| 结构断言 | `python engine/test_structure.py` | `STRUCTURE PASS（88 条）` |
| 渲染安全 | `python engine/test_render_safety.py` | `ALL PASS（182 条）` |
| 发布 | `git push origin master` | Gitee 权威源 → GitHub 镜像 → Actions `build.yml`（门禁）/ `publish-pages.yml`（构建+发布） → Cloudflare Pages |

**实测记录（2026-10-18）**：`new` 建 `demo-chain` → build 文章 3 篇 → check/build/test 全绿 →
HTTP 取到 `p/demo-chain.html`（408 B）与 `summaries/demo-chain.json`（182 B）→ browser 51 项通过 → 删除演示文章并重新构建回 2 篇。

> 发布细节与回滚见 `docs/DEPLOY.md`；字体见 `docs/FONTS.md`；架构见 `docs/ARCHITECTURE.md`。

---

## 3.5 头像怎么放

优先级（从高到低）：

1. `avatar:` 字段（`site/content/members/<id>.sml`）——可以是本地路径或 `https://` 链接；
2. `site/content/members/<id>.jpg|png|webp`；
3. `site/content/avatars/<id>.…`；
4. 站点根 `site/<id>.…`。

远端链接（GitHub / Gitee 头像都行）会在**构建期下载**到 `site/meta/avatars/` 缓存，
再把本地路径写进 manifest。好处：

- 访客运行时**零外部请求**（不连 githubusercontent.com，也不受国内网络影响）；
- 不需要给站点配"GitHub 加速"；
- 下载失败会 warning 并回退占位圆，不会阻断构建。

站点 logo 用 `site/p.qlogo.jpg`（同时作为 favicon）。

## 4. 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| `E-CONTRACT-004 契约 BlogPost 未声明字段 xxx` | 新字段要先加到 `site/content/contracts/blog.sml`（或在契约里写 `loose`） |
| `E-CONTRACT-003 缺少必填字段 summary` | front matter 补 `summary` |
| 文章页没有「章节导图」 | **导图默认关闭**：front matter 加 `map: true` 重新构建；`md-writing` 没加，所以没有 |
| 导图弹层打不开/空白 | 只有 `map: true` 的文章生成 SVG；结构清单（目录）任何文章都有 |
| 视频只有一张卡、不播放 | 设计如此：点击后才注入 iframe（零第三方请求），可再「收起视频」 |
| 字体没生效 | `site/fonts/src/MiSans-*.ttf` 是否存在；构建日志应有「字体子集 N 个」 |
| 搜索搜不到新文章 | 重新 `build`（搜索索引在构建期生成） |
| 日期链接点开是空的 | 那天确实只有这篇文章；日期来自 front matter 的 `date` |
| 本地预览中文乱码 | 用 `cli.py preview`（带 `charset=utf-8`），不要用 `python -m http.server` |

---

## 5. 想改引擎/前端时

```bash
python engine/cli.py build --offline
node tests/browser-check.js        # 需要 Node + 本机 Edge/Chromium
python engine/test_structure.py
python engine/test_render_safety.py
```

改 `engine/` 或 `site/content/contracts/` 属于高影响改动：PR 里写清「改了哪条、为什么」，
并保证上面四条全绿。前端没有打包步骤，改完 `site/theme/*` 直接重建即可。
