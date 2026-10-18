# 审计修复报告（AUDIT-REMEDIATION）

- 日期：2026-10-19
- 范围：`engine/`、`site/theme/`（只读）、`tests/`、`.github/workflows/`、根与 `docs/` 的文档；
  未改 `gui/**`、`Cargo.toml`、`Cargo.lock`、`engine/gui.py`、`engine/gui_api.py`（GUI 任务边界），
  未改 `site/content/` 任何正文。
- 依据：`C:\Users\sakeen\Documents\deepseek-harness\default-workspace\audit\report.md`（已通读）
  + 任务给的「已知清单」A–D，逐条实测复核。
- 基线提交：`c4600ba`（URL 白名单 + AGENTS 文档更新）之后。

## 1. 核查表

编号沿用任务清单；「证据」列给文件:行 或实测输出。

| # | 项目 | 结论 | 证据 |
|---|---|---|---|
| A | URL 协议白名单（审计第 2 条） | **fixed（c4600ba）+ 本次补 3 个出口** | `engine/lib/urls.py`；`render.py:75/93-98/265/278/329/351`、`markdown.py:139-152/305/337` 全过 `safe_url`；`build.py:409-412/539/642/674/1229/1244` 清洗 manifest。本次新增：`site.url` 过白名单（`build.py:1229`）、og:image 的 `site.url` 转义（`build.py:884`）、feed `<link>/<guid>` 的 slug 转义（`build.py:1398-1401`） |
| A-附 | 其余被点名出口 | fixed（无需改动） | `{ref:}` 只产 `#` 锚点（`render.py:75`，输入已转义）；无 video/poster/srcset/CSS `url()` 生成点；Markdown 无自动链接（裸 URL 不链接化）；图片 caption 走 `md_inline` → `link()` 白名单（`markdown.py:148-152`）；sitemap 全量 `esc(u)`（`build.py:1385`）；llms.txt 是纯文本；导图 href/label 在 `mindmap.py:26/112` 双转义 |
| A-附 | GUI 侧（只读检查，未改） | **open → 移交 GUI 任务** | `engine/gui_api.py:494` 预览 HTML 用同一个全局 `replace('src="assets/', ...)`（与本次修掉的 `build.py` 旧写法同类）。仅影响本地预览、且预览内容同样经过构建期转义，当前不可利用；建议 GUI 任务改用与 `build._localize_assets()` 相同的只改 `<img src="` 写法 |
| C1 | 契约名拼进 HTML 属性未转义 | fixed | `build.py:696` `esc(ident)`；回归 `test_render_safety.py [1]`（3 个 payload + 正向对照 + toc/导图断言） |
| C2 | 内联角色双重转义 | fixed | `render.py:59-99` `_role()` 不再对已转义文本二次 esc；回归 [2] |
| C3 | Markdown 嵌套列表 repr / TypeError | fixed | `markdown.py:181-211` `build()` 统一返回 str 并补 `<ul>/<ol>` 外壳；回归 [3] |
| C4 | `src="assets/` 全局替换改写代码块 | **fixed（本次收紧为显式契约）** | 原写法 `build.py:284`（旧行号）已被 esc-first 设计兜住（实测代码块内是 `src=&quot;…`，不匹配、不改写、不误报）；本次抽出 `build._localize_assets()` 只匹配 `<img src="assets/`，把隐不变式变成显式契约 + 回归 [11] |
| C5 | `--out` 无守卫 | fixed | `build.py:113-134` `guard_out()`（拒绝仓库根/站点目录及其上级、仓库内非 dist 位置）；回归 [4] 8 条 |
| C6 | SML 异常类型不受控 | **open → 本次修复** | 修复前实测（builtin=CI 路径）：`x: "\uZZZZ"` → ValueError；`"\u{110000}"` → ValueError；`"\u12"` → ValueError 且越过引号继续读；`@a { k: &a }` / 互相引用 → RecursionError；CLI/build 完全不接 SmlError（traceback 退出） |
| C7 | LICENSE / 字体许可 | fixed | 根目录 `LICENSE`（MulanPSL-2）、`LICENSE-CONTENT`（CC BY-NC-SA 4.0）；`site/fonts/LICENSE-MiSans.txt` 入库且 `build.py:838` 拷到 `dist/fonts/`（本次构建实测 `dist/fonts/LICENSE-MiSans.txt` 存在） |
| C8 | CI 真正跑 test + check | fixed | `.github/workflows/build.yml:57-79`：test_contracts → test_render_safety → build（**无** `--warn-only`）→ check → test_structure；PR 也触发（`pull_request` 已配） |
| C9 | Python 最低版本未写明 | **open → 本次修复（文档）** | 下界由 `git_ready.py` 的 `unlink(missing_ok=True)` 决定 = 3.8；README/WORKFLOW/CONTRIBUTING/engine/README 原写「3.11+」，本次统一为「3.8+（CI 用 3.11）」 |
| C10 | 测试断言计数器与代码脱节 | **open → 本次修复** | 修复前：test_contracts 实际 21 处 `case(` vs 文案与三处文档写 19；test_render_safety 实际 137 vs WORKFLOW 写 112；test_structure 实际 88 vs 写 84。本次：脚本改动态计数（`test_contracts.py:55-57/93`），文档数字全部对齐实测（21 / 182 / 88） |
| B | 文档漂移 | **open → 本次修复** | 见 §3；涉及 README/CONTRIBUTING/engine/README/docs{WORKFLOW,ARCHITECTURE,DEPLOY,FONTS,ROADMAP}/AGENTS 共 9 个文件 |

## 2. 本次修复明细（每项一个独立 commit）

| commit | 类型 | 内容 |
|---|---|---|
| `8252d0d` | fix(engine) | SML 异常类型受控 + build/cli 人话退出 |
| `334f740` | fix(engine) | assets 前缀改写只动 img 属性；site.url 过白名单；feed/og 出口补转义 |
| `e00d570` | fix(tests) | 契约自测断言计数动态化 |
| `8293f27` | docs | README/CONTRIBUTING/engine/README 与 docs/ 对齐实际结构、命令与计数 |

### 2.1 `8252d0d` SML 异常类型（审计 C6 / §3.5 / §7 第六名）

- `engine/lib/sml.py`：
  - 新增 `_Parser._hex_cp()`：`\uXXXX` / `\u{...}` 必须是十六进制、码点 ≤ 0x10FFFF，
    否则 `self.err()` → `SmlError("path:line: …")`。修掉了三个真实泄漏：
    `\uZZZZ`（ValueError）、`\u{110000}`（chr 越界）、`\u12`（不足 4 位且**越过引号继续读**）。
  - `_expand()` 加展开链环检测（`_active`）：自引用 / 互相引用片段抛
    `SmlError("片段引用成环：&a（a -> b -> a）")`，与原生后端的 E-INCLUDE-006 口径一致。
  - `_strip_directives(text, path)` 透传 path：原生路径的 `\u` 错误也带真实文件路径
    （两条后端都经过 `string()`，修一处全覆盖）。
- `engine/build.py`：`main()` 拆出 `_run(args)`，`main` 接住 `sml.SmlError` →
  打印 `[E-SML-001] SML 解析失败：<文件:行号: 原因>`，退出码 1，不再出 traceback。
- `engine/cli.py`：`contracts` / `list` 子命令同样转人话（return 1）。
- 顺带修 3 处 docstring 里的陈旧路径（`tools/build.py`、`tools/check.py`、`tools/test_contracts.py` → `engine/…`）。
- 回归：`test_render_safety.py [10]` —— builtin/native 双后端各 6 个非法输入必须
  SmlError、2 个合法输入（`\u4e2d`、`\u{6587}`、片段链）不受影响、错误消息带
  `文件:行号`、并用临时站点子进程端到端断言 build 退出码 1 / E-SML-001 / 无 traceback / 定位到行。

### 2.2 `334f740` URL 与 assets 出口（审计 A / §3.4）

- `engine/build.py`：
  - 抽出 `_localize_assets(html, slug, post_dir)`：检查与改写都只认
    `<img src="assets/`，取代全局 `replace('src="assets/', …)`。返回
    `(html, 缺失列表)`；缺失清单只含真实 img 引用，代码块里的示例既不改写也不误报。
  - manifest `site.url` 过 `urls.safe_url()`（站点配置在 `site/content/` 里，属投稿面；
    与 `repo_url` / `avatar` / `group.join_url` 同纪律）。
  - `inject_head` 的 og:image 给 `site.url` 补 `render.esc`（`build.py:884`）。
  - `feed.xml` 的 `<link>` / `<guid>` 给 slug 补 `esc`（slug 来自目录名，
    git 里不保证不含引号/尖括号；title/summary 原本就已 esc）。
- 回归：`test_render_safety.py [11]` 两组 —— `urls.safe_url` 单元口径
  （http/https/mailto/tel/`#`/相对路径/绝对路径放行；javascript:/data:/vbscript:/
  file:/协议相对 `//`/含控制字符/空值拒绝，共 8+10 例）与 `_localize_assets` 契约
  （真实 img 改写、代码块示例不动、缺失清单只含真实引用、不存在 img 仍改写保持旧行为）。

### 2.3 `e00d570` 断言计数（审计 C10 / §5.1）

`test_contracts.py` 的 `case()` 动态计数（`test_contracts.py:56-58/94`），打印文案不再写死；文档数字在 `8293f27` 对齐。

### 2.4 `8293f27` 文档漂移（审计 B / §6）

- **README.md**：目录树补齐 `lib/{urls,mathml,summary,_swsml}`、`native/`、
  `vendor/latex2mathml`、`gui/`、`tests/`、`deploy/`、Cargo、Dockerfile；engine 文件清单补
  `test_render_safety/test_structure/verify_parity/ai_summarize/fonts_import/git_ready/gui/gui_api`；
  新增 Python 3.8+ 与许可文件指引。
- **CONTRIBUTING.md**：Python 3.8+；自检命令补 `test_render_safety` / `test_structure`。
- **engine/README.md**：职责表补 9 行（gui/git_ready/test_structure/lib 新文件/native/vendor）；
  验证节改为提交前五连；去掉写死的「19 项断言」。
- **docs/WORKFLOW.md**：Python 3.11+ → 3.8+；计数 19/112/84 → 21/182/88；树补 gui/
  deploy/Cargo/Dockerfile/ai_summarize/git_ready/native；workflows 补 publish-pages.yml；
  browser-check 项数改为「N 项」（本机无 Node/Edge，未实测不写死数字）。
- **docs/ARCHITECTURE.md**：`engine/sml.py` → `engine/lib/sml.py`（markdown/mindmap 同）；
  lib 清单补 urls/mathml/summary/_swsml；`updated`「缺省取 git 时间」改为实际（取 `date`，
  手写 `updated` 才显示更新于 —— 与 AGENTS.md §7 一致）；「串行 + 节流」改为实际
  （串行、无节流、失败降级缓存）；前端 `innerHTML` 描述改为实际口径（仅预渲染片段，
  投稿文本走文本节点）；`@is` 标注团队约定走 `contracts{}` 默认映射（builtin 后端会报错）；
  导图产物路径改为实际（文章导图需 `map: true`；文档页在 `pages/` 不在 `d/`）；
  断言计数不写死。
- **docs/FONTS.md**：补加密包机制（`misans-fonts.tar.gz.enc` + `FONT_PASSWORD` +
  `deploy/fonts-crypt.sh`），src/ 与 subset/ 均不入库与 `.gitignore` 对齐
  （原文档与 AGENTS.md 的「子集入库」说法与 `.gitignore` 事实不符）。
- **docs/ROADMAP.md**：字体条目同步为加密包机制；子集体积改为实测约 254 KB。
- **AGENTS.md**：fonts 条同步加密包机制；engine 树补 `test_structure.py`；
  提交前四连 → 五连。
- **docs/DEPLOY.md**：§2 改为 pages 分支实际链路；两处自检命令补全五连。

## 3. 未修项与原因

| 项 | 原因 / 去向 |
|---|---|
| `engine/gui_api.py:494` 预览 HTML 的全局 `src="assets/` 替换 | GUI 任务边界（禁改 `gui/**` 与 `engine/gui_api.py`）。仅影响本地预览、内容同样经过构建期转义，当前不可利用。已在本文件 §1 记录，建议 GUI 任务改用 `build._localize_assets()` 的只改 `<img src="` 写法 |
| `build.py` `REQ["doc"]` 死键、`REQ.get("page"/"topic")` 取不到（审计 §3.8-d） | 配置与代码脱节但被 `site.sml` 的 `contracts{}` 兜住，无行为差异；属「顺手清理」类，按任务要求不顺手重构 |
| RSS `<lastBuildDate>`/`<pubDate>` 用 ISO-8601 而非 RFC 822（审计 §3.8-a） | 显示层问题、无安全影响，未在任务清单内，不扩范围 |
| sitemap/feed 用 hash URL（审计 §3.8-b） | 站点是 hash 路由 SPA 的既定设计，改它等于改信息架构，超出审计修复范围 |
| `repo_meta` 无节流、`cache.save()` 无条件重写 `meta/repos.json`（审计 §3.8-h / §4.2） | 性能/噪音类，未在清单内 |
| `lib/sml.py` 内置解析器报错行号偏 1（AGENTS.md 已知缺陷） | 上游行为，AGENTS.md 已登记为已知缺陷；本次 `_hex_cp` 的行号按转义符位置取，实测正确 |
| `tests/browser-check.js` / `smoke.js` 项数 | 本机无 Node + Edge，未实测；WORKFLOW.md 已改为不写死 browser-check 数字 |
| 契约分叉守卫（编辑器上游校验 vs Python 侧重写校验，AGENTS.md §6.1 已登记风险） | 需要 VS Code 扩展运行时，超出本机可验范围；AGENTS.md 已登记 |

## 4. 验收输出（2026-10-19，本机 Python 3.14，native 后端可用）

```
$ python engine/test_contracts.py
契约自测 ALL PASS（5 个契约，21 项断言）

$ python engine/test_render_safety.py
…（[1]–[11] 全 ok，含双后端 SML 错误类型、safe_url 单元、assets 改写契约）
182 项断言
ALL PASS

$ python engine/test_structure.py
结构断言 88 条（三栏 / 左栏纯净 / 右栏收起 / 版心 / 溢出 / 首屏 / 零外链 / 回归钉）
STRUCTURE PASS

$ python engine/cli.py build --offline
   字体子集 2 个，共 261 KB（MiSans）
  [warn] fonts: 缺 brotli（woff2 压缩），子集改用 woff —— 浏览器同样支持
产物：…\dist（文章 3 / 项目 2 / 成员 2 / 黄页 1）

$ python engine/cli.py check
文章 3 / 项目 2 / 成员 2 / 资源 2 / 周报 1 / 文档 12 / 黄页 1
ALL PASS

$ python tests/gui_api_test.py
Ran 10 tests in 3.673s
OK

$ python -m compileall -q engine
exit=0
```

自查：

- `grep "javascript:" dist/`（含 html/json/xml/txt/css/js）→ 0 命中；
  `vbscript:` / `data:text/html` 同样 0 命中。
- `urls.safe_url` 单元用例（test_render_safety [11]）覆盖
  http/https/mailto/tel/`#`/相对路径/绝对路径放行 与
  javascript:/data:/vbscript:/file:/协议相对/控制字符/空值拒绝。
- AGENTS.md 无「没有 URL 协议白名单」类过期描述（白名单已落地并有回归）。
- 提交纪律：4 个独立 commit，只动 engine/、tests/（只读运行）、根与 docs 的 .md；
  未提交任何 `gui/**`、`Cargo.*`、`engine/gui*.py`（保持未跟踪状态交还 GUI 任务）。
