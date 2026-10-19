# 写作台移交文档（截至 2026-10-19 · M2 完成）

> 给下一个接手的 AI / 人：本文件报告**实现现状**、**怎么跑**、**已知坑**、**下一步**。
> 规格与设计不要在这里重写，去读 `docs/GUI.md`、`docs/GUI-FLOWS.md`、`docs/GUI-IMPLEMENT-PROMPT.md`。
> 实现细节与 mock 差异看 `docs/GUI-IMPLEMENT.md`。仓库入口 `AGENTS.md`。

## 1. 现在做到了哪

| 期 | 状态 | 内容 |
|---|---|---|
| M1 | ✅ 完成 | 启动、内容树、打开、契约表单（默认收起）、Markdown 编辑、保存/校验、手动预览、新建、草稿 |
| M2 | ✅ 完成 | 图片上传/拖入、工具条 + 插入菜单、资源附件弹层与「写入前确认」、构建期解析 `Attachment.resource`、M/U/D 徽标、右键菜单（打开/重命名/转草稿/复制站内链接/删除）、外部改动检测（409）、提取码复制 |
| M3 | ⬜ 未做 | 登录 / 钥匙串 / 清除痕迹、`/api/pr`（fork 兜底）、设置页、`--features desktop` Tauri |

分支状态：全部本地提交、**未 push、未 force、未碰 master**；HEAD 附近新增 6 个提交
（`4e9a747` → `3c68a71`），叠加在并行提交之上。

## 2. 怎么跑

```bash
# 安装二进制（Rust 侧）
cargo install --path gui                 # --force 即更新
rec-blog --site <仓库根或站点目录>        # 两种形态都能吃；--port 0 / --no-open / update / --version

# 只跑引擎侧（不经 Rust）
python engine/gui.py --port 0            # stdout 打印 GUI_PORT=<n>；GUI_TOKEN 走环境变量
```

## 3. 验收（M2 结束时全绿，逐条贴过）

| 命令 | 结果 |
|---|---|
| `cargo fmt --check` | 无输出（干净） |
| `cargo clippy -- -D warnings` | Finished，0 warning |
| `cargo test` | 19 passed; 0 failed |
| `python engine/test_contracts.py` | ALL PASS（5 契约，21 断言） |
| `python engine/test_render_safety.py` | 182 项断言 ALL PASS |
| `python engine/test_structure.py` | 88 条 STRUCTURE PASS |
| `python tests/gui_api_test.py` | **18 passed; 0 failed**（M1 十条 + M2 八条） |
| `python engine/cli.py build --offline && python engine/cli.py check` | ALL PASS（仅字体 woff 告警） |
| `node tests/smoke.js`（附加） | SMOKE PASS（含新增「附件卡与提取码」用例） |
| `node tests/gui_dom_test.js`（新增） | GUI DOM PASS（17 项） |

## 4. 代码地图

```
gui/src/    args.rs 参数 / engine.rs 引擎发现+握手+git commit / assets.rs 静态白名单 /
            server.rs 反代 / session.rs 令牌脱敏 / desktop.rs Tauri（feature 占位）
gui/assets/ index.html 三栏 + 弹层 / app.js 全部前端逻辑 / api.js fetch 封装 / style.css
engine/gui.py    入口（--port/--site、GUI_TOKEN、握手行）
engine/gui_api.py API 业务（类型/树/文档读写/校验/预览/新建/图片/资源/删除/重命名/状态）
tests/gui_api_test.py  起真实服务的 Python 回归（临时站点，不碰真实 content）
tests/gui_dom_test.js  用 tests/dom-stub.js 的前端 DOM 冒烟（假 fetch，不联网）
```

关键约束（踩线即 bug，详见 `AGENTS.md` §6 写作台红线）：

- Rust **不写 UI、不重写引擎**；解析/渲染/契约/构建全走 `engine/`；
- 路径白名单 `realpath ⊆ site/content/** ∪ site/theme/**`，否则 403；
- 保存：UTF-8 **无 BOM**、LF、末尾换行，保存前跑契约，**422 不写盘**；带 `base_hash` 时磁盘被改过 **409 不覆盖**；
- 令牌只走环境变量/内存/钥匙串，两侧日志都 `redact()`；
- 新拼 href/src 必须过 `urls.safe_url()`（Python） / `safeUrl()`（JS）；提取码只当文本。

## 5. 已知问题 / 未修项（移交时请注意）

1. **M2 的删除/重命名还没做登录门禁**：`/api/delete`、`/api/rename` 只校验 `X-GUI-Token`
   （本地进程级），**没有**「管理员」判断——这是 M3 的事，文档已标注。别以为它有权限控制。
2. **SML 文件转草稿做不了**：`POST /api/doc` 的 SML 路径只接受整篇 `raw`，前端会把
   `draft: true` 按原文写回，所以 `ctxDraft` 对 `.sml` 明确提示「M2 未做 SML 字段写回」。
   M3 补：解析 SML → 改 `draft` 键 → 重新序列化（注意双后端差异）。
3. **重命名不改站内引用**：`/api/rename` 只 `git mv`，正文里手写的 `#/post/<slug>` 之类
   不会自动更新。文档已说明；要做请在 M3 加「引用扫描 + 确认」。
4. **插入菜单的图片项是隐形占位**：`.md` 的图集模板插的是 `assets/a.png` 字面量，需要用户
   自己把图放进去（或直接用品牌图片入口上传后再改路径）。
5. **`document.execCommand('insertText')`** 是保留撤销栈的写法，浏览器若弃用会退回手动
   splice（丢撤销栈）。Rust/前端都不用管，但 DOM 桩测试里它不存在，走的是降级分支。
6. **PowerShell 环境下偶发 `System.AccessViolationException`（AMSI）**：与本仓库代码无关，
   命令重试即可；M2 期间遇到约 6 次。
7. `tests/gui_dom_test.js` 里 `sandbox.api = window.api` 是必需的接缝（桩里 window ≠ 全局），
   真实浏览器无此问题——**别删那行**。
8. 字体告警「缺 brotli，子集改用 woff」是环境缺包，不影响结论（`rep.warn` 不进退出码）。

## 6. 下一步（M3，按依赖顺序）

1. `gui/src/session.rs`：keyring 存储 token（Windows Credential Manager / macOS Keychain / libsecret），
   失败降级「仅本次会话」；`POST /api/session` 调 Gitee `GET /user` 校验；`POST /api/purge`
   逐项返回清了什么（钥匙串 token / 最近文件 / 预览缓存 / 日志）。
2. `engine/gui_api.py`：`/api/pr`（`checkout -b` → `add` → `commit` → `push` → Gitee PR；
   push 403 走 fork 兜底 `head=<user>:<branch>`；**永不 force、永不推 master**；无 token/失败
   返回 `compare_url` + 命令，**不执行 git**）。Rust 侧反代 `/api/pr` 时注入 `X-Gitee-Token`。
3. `site/content/site.sml` 加 `reviewers: [sal]`，支持 `REC_BLOG_REVIEWERS` 覆盖。
4. UI：`login.html`（记住 / 仅本次会话）、`settings.html`（账户与安全 / 外观 / 编辑 / 资源与附件 /
   关于；设置存 `localStorage`，**不含 token**；两个按钮文字开关）。
5. 删除/重命名加「管理员」门禁（登录后才可用，未登录置灰）。
6. Tauri：`--features desktop` 实跑 `cargo check --features desktop` 与 `cargo build --features desktop`，
   成功则文档写「Tauri 已在 Windows 验证」，失败则贴完整命令 + tauri/tao/wry 版本 + 错误码 + 关键日志。
7. 测试补齐：无 token 调 `/api/pr` → 明确错误且 `git status` 不变；钥匙串降级；脚本脱敏。

## 7. 测试怎么写才有意义（经验）

- Python 侧起**真实服务**（`engine/gui.py --port 0`），用临时站点目录（`site.sml` + `contracts` +
  一篇文章 + `resources` + `theme`），别碰真实 `site/content`；跑构建用
  `python engine/build.py --site <tmp> --offline --out <tmp>/dist`（`--out` 有守卫，仓库外放行）。
- 前端用 `tests/dom-stub.js` + 假 `fetch`；DOM 桩没有 `remove()`/`dataset`/冒泡，
  断言优先 `class` / `textContent` / `children.length`；`onclick` 属性要手调。
- 写一条就删一条临时文件（`finally` 里清理），否则会污染同进程后面的用例。
