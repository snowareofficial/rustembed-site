# 文件结构 · git 写作流程 · 全链路

面向两类人：**第一次投稿的群友**（只想写一篇）和**维护站点的人**（要改前端/引擎/发布）。
所有命令都在仓库根目录执行，Python 3.8+（CI 用 3.11），不需要 Node（前端零构建；`tests/browser-check.js` 才需要 Node）。

---

## 1. 文件结构（改哪里）

```
rec-blog/
├─ engine/                    构建器（可整体复制给别的站点）
│  ├─ cli.py                  唯一命令行入口：new/list/assets/gen/contracts/build/check/test/preview
│  ├─ build.py                入口：argparse + 主流程 _run（实现在下面各子包）
│  ├─ check.py                产物自检
│  ├─ preview.py              本地静态服务（带 charset，后台运行）
│  ├─ core/                   config / paths / content_paths / contract / contracts / urls / report
│  ├─ parse/                  sml / _swsml（SML 解析与原生绑定）
│  ├─ render/                 render / markdown / mindmap / mathml
│  ├─ content/                posts / projects / members / quotes / topics / services / pages …
│  ├─ pipeline/               assets / manifest / fonts（产物出口）
│  ├─ tools/                  ai_summarize / fonts_import / git_ready / native_build /
│  │                          verify_parity / audit_images
│  ├─ tests/                  test_contracts / test_sml_include / test_render_safety /
│  │                          test_structure / test_images
│  ├─ native/                 SML 原生后端 sml.dll（gitignore；没有就回退内置解析器）
│  ├─ prompts/summarize.md    AI 摘要的输入输出约定（构建期离线步骤用）
│  └─ vendor/                 vendored fontTools 与 latex2mathml（不是 pip 依赖）
│
├─ archive/gui/               已归档的写作台（2026-10-28，只读；恢复见其 README.md）
├─ Dockerfile                 自托管构建器镜像
│
├─ site/                      本站点（内容都在这里）
│  ├─ content/
│  │  ├─ site.sml             站名/导航/群信息/公告/群规/大事记/契约默认映射
│  │  ├─ posts/<年>/[系列/]<短名>/    文章：index.md 或 index.sml + assets/（图片）
│  │  ├─ pages/*.sml          站文档（投稿指南、写作速查、附件规则、制度…）
│  │  ├─ topics/*.(md|sml)    主题词条（同标签文章自动归入）
│  │  ├─ members/<id>.sml     成员档案（同目录 <id>.jpg 自动当头像）
│  │  ├─ services/<id>.sml    能力与合作黄页（纯展示）
│  │  ├─ projects/<id>.sml    项目（构建期抓仓库元数据）
│  │  ├─ resources/<id>.sml   资源库
│  │  ├─ weekly/<期>.sml      周报
│  │  ├─ summaries/<slug>.json  可选：AI 摘要产物（有就用，没有退回抽取式）
│  │  └─ contracts/*.sml      内容契约（字段即文档；改契约=改校验=改契约页）
│  ├─ theme/                  index.html + css/ + js/（hash 路由 SPA，零构建；顺序见 index.html）
│  ├─ fonts/                  src/ 与 subset/ 均 gitignore；CI 解密加密包（FONT_PASSWORD）再子集化
│  └─ meta/repos.json         仓库元数据缓存（入库）
│
├─ tests/                     前端验收（Node）
│  ├─ smoke.js                路由的 DOM 冒烟
│  ├─ theme-files.js          多文件加载唯一事实源（解析 index.html 的 link/script 顺序）
│  ├─ browser-check.js        无头 Edge 检查 runner（布局/溢出/对比度/摘要/导图拖动）
│  ├─ browser_lib.js          CDP 连接 / 起浏览器 / 断言工具 / 报告
│  ├─ browser_checks_*.js     检查用例（layout / pages / reading / settings 四模块）
│  ├─ dom-stub.js             DOM 桩（跑 js/ 多文件视图用，theme-files.js 按 index.html 顺序加载）
│  ├─ content_tree_test.py    目录树守卫回归（E-POST-001/003/004，临时站点跑真实 build）
│  ├─ i18n_test.py            多语言（index.en.md / 语言切换）回归
│  └─ tech_aid_test.py        技术互助黄页产物回归
│
├─ deploy/                    自托管：entrypoint / build / rebuild / gitee-webhook / fonts-crypt
├─ docs/                      ARCHITECTURE / DEPLOY / FONTS / GOVERNANCE / ROADMAP / SELF-HOST /
│                             WORKFLOW（本文）
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
- 也可以手写：`site/content/posts/<年份>/[系列/]<英文短名>/index.md`（短名只用小写字母/数字/连字符）

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
| 结构断言 | `python engine/tests/test_structure.py` | `STRUCTURE PASS` |
| 渲染安全 | `python engine/tests/test_render_safety.py` | `ALL PASS` |
| 目录树守卫 | `python tests/content_tree_test.py` | `OK（3 条）` |
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
python engine/tests/test_structure.py
python engine/tests/test_render_safety.py
```

改 `engine/` 或 `site/content/contracts/` 属于高影响改动：PR 里写清「改了哪条、为什么」，
并保证上面四条全绿。前端没有打包步骤，改完 `site/theme/*` 直接重建即可。

---

## 6. `code` 分支（暂时废弃）

**2026-10-20 起暂时废弃 `code` 分支模型。**

现在的模型是：

- **Gitee `master` = 全量源**（`engine/` + `site/` + `docs/` + workflows）；
- `sync-from-gitee` 每 15 分钟整树被动镜像到 GitHub；
- GitHub 不再接受日常直接 push；
- `.github/workflows/sync-code.yml` 只保留手动应急入口，不再定时运行。

历史模型（仅供理解旧文档）：

```text
Gitee code → sync-code → GitHub engine/theme
Gitee master → 内容
```

这个模型的缺点是代码与内容两条同步链会互相覆盖；暂时统一到 `master` 全量源。

| 改什么 | 推哪里 | 多久到 Pages |
|---|---|---|
| 文章/成员/资源等 `site/content/**` | Gitee `master` | 下个 15 分钟窗口，或手动触发 publish |
| `engine/**`、`site/theme/**` | Gitee `master` | 下个 15 分钟窗口 |
| `.github/workflows/**`、文档 | Gitee `master` | 下个 15 分钟窗口 |

安全边界：Gitee `master` 的 PR 仍要经过 review；内容投稿者不应直接改 `engine/`、`site/theme/`，由维护者审查。

---

## 7. staging 预览：Gitee staging → master

缓冲放在 **Gitee 源分支**，不是构建产物：

```
Gitee staging 内容 → preview 分支（Cloudflare Preview / staging）
        │  人工确认
        ▼
Gitee master 内容  → pages 分支（生产）
```

分支职责：

| 分支 | 内容 | 谁写 |
|---|---|---|
| Gitee `staging` | 内容预览源 | 作者 PR / 维护者 |
| Gitee `master` | 生产内容 + 代码全量源 | 只接受 staging 合并 + 维护者 commit |
| GitHub `preview` | staging 构建产物 | CI 强推 |
| GitHub `pages` | 生产构建产物 | CI 强推（master） |

第一次启用：

```bash
# Gitee：从 master 建 staging
git branch staging
git push origin staging
```

日常：

```powershell
# 作者：改 staging，等 preview
git checkout staging
# ... 改 site/content/...
git push origin staging

# 维护者：看 Cloudflare Preview 的 preview 分支 URL，确认后合并
git checkout master
git merge staging
git push origin master
```

CI 每 30 分钟（或手动 `publish-pages.yml`）会同时构建两个矩阵任务：

- `staging → preview`：原样使用 staging 内容；
- `master → pages`：生产内容，带 AI 摘要。

Cloudflare Pages 项目需要允许 Preview deployments，`preview` 分支才会生成 staging URL；
生产分支仍是 `pages`。回滚时对 Gitee `master` 做 revert，或把 `pages` 指回上一个构建提交。





