# 写作台移交文档（截至 2026-10-19 · M3 完成）

> 给下一个接手的 AI / 人：本文件报告**实现现状**、**怎么跑**、**已知坑**、**下一步**。
> 规格与设计不要在这里重写，去读 `docs/GUI.md`、`docs/GUI-FLOWS.md`、`docs/GUI-IMPLEMENT-PROMPT.md`。
> 实现细节与 mock 差异看 `docs/GUI-IMPLEMENT.md`。仓库入口 `AGENTS.md`。

## 1. 现在做到了哪

| 期 | 状态 | 内容 |
|---|---|---|
| M1 | ✅ 完成 | 启动、内容树、打开、契约表单（默认收起）、Markdown 编辑、保存/校验、手动预览、新建、草稿 |
| M2 | ✅ 完成 | 图片上传/拖入、工具条 + 插入菜单、资源附件弹层与「写入前确认」、构建期解析 `Attachment.resource`、M/U/D 徽标、右键菜单、外部改动检测（409）、提取码复制 |
| M3 | ✅ 完成 | 登录（Gitee 校验 + 系统钥匙串/内存，失败降级不落文件）、`/api/pr`（fork 兜底，永不 force/永不推 master）、写操作登录门禁（401）、`reviewers`（site.sml + 环境变量）、设置页（localStorage 不含令牌）、清除痕迹（按勾选项逐项）、Tauri 原生窗口（Windows 已验证） |

分支状态：全部本地提交、**未 push、未 force、未碰 master**；M3 提交叠加在
`6809e3a`（hy3/hy4 分工提示词）之上。

## 2. 怎么跑

```bash
# 安装二进制（Rust 侧）
cargo install --path gui                 # --force 即更新
rec-blog --site <仓库根或站点目录>        # 两种形态都能吃；--port 0 / --no-open / update / --version
rec-blog --desktop --site . --no-open --port 8788   # 原生窗口（需 --features desktop 编译）

# 只跑引擎侧（不经 Rust；登录态接口不可用，见下）
python engine/gui.py --port 0            # stdout 打印 GUI_PORT=<n>；GUI_TOKEN 走环境变量
```

注意：`/api/session`、`/api/whoami`、`/api/purge`、`/api/recent`、`/api/about` 由 **Rust 层**
直处理（钥匙串与内存态只存在于 Rust）。绕过 Rust 直连 Python 时这些接口 404，
`/api/pr`、`/api/delete`、`/api/rename` 也会因没有 `X-Gitee-Token` 而 401——这是设计，不是 bug。

## 3. 验收（M3 结束时全绿，逐条贴过）

| 命令 | 结果 |
|---|---|
| `cargo fmt --check` | 无输出（干净） |
| `cargo clippy -- -D warnings`（含 `--all-targets`） | Finished，0 warning |
| `cargo test` | 27 passed; 0 failed |
| `cargo check --features desktop` | Finished（tauri 2.12.4 / wry 0.57.0 / tao 0.37.1 / webview2-com 0.39.1） |
| `cargo clippy --features desktop --all-targets -- -D warnings` | 0 warning |
| `cargo test --features desktop` | 27 passed; 0 failed |
| `cargo build --features desktop` | **Finished（1m44s）**；`rec-blog.exe` 20.6 MB，`--version` 正常输出 |
| `python engine/test_contracts.py` | ALL PASS（5 契约，21 断言） |
| `python engine/test_render_safety.py` | 187 项断言 ALL PASS |
| `python engine/test_structure.py` | 91 条 STRUCTURE PASS |
| `python tests/gui_api_test.py` | **23 passed; 0 failed**（M1 十条 + M2 八条 + M3 五条） |
| `python engine/cli.py build --offline && python engine/cli.py check` | ALL PASS（仅字体 woff 告警） |
| `node tests/gui_dom_test.js`（附加） | GUI DOM PASS（M2 用例不回归） |
| M3 新 UI DOM 冒烟（附加，临时脚本） | **42 项全过**：未登录置灰/登录启用、PR 弹层（文件多选/默认分支/reviewers 增删/成功链接）、safeUrl 白名单 9 项、登录页（空令牌/401 态）、设置页（主题即时生效/清除痕迹逐项结果/没勾选不调用） |

Tauri 备注：用户级 `.cargo/config.toml` 把 target-dir 指向 `D:/snoware-target`，
M3 期间 D 盘写满（0 GB 剩余），`cargo build --features desktop` 改用
`CARGO_TARGET_DIR=C:\snoware-target-desktop` 完成；默认特性的构建/测试仍在 D 盘原目录全绿。
D 盘清理后可按需删掉 C 盘这个临时 target 目录。

## 4. 代码地图

```
gui/src/    args.rs 参数 / engine.rs 引擎发现+握手+git commit / assets.rs 静态白名单 /
            server.rs 反代+登录态接口 / session.rs 脱敏+钥匙串+Gitee+pruge / desktop.rs Tauri
gui/assets/ index.html（写作台）/ login.html / settings.html / app.js（三页共用）/ api.js / style.css
gui/        tauri.conf.json / build.rs / icons/icon.ico（desktop 特性）
engine/gui.py    入口（--port/--site、GUI_TOKEN、握手行）
engine/gui_api.py API 业务（… + reviewers + PR；REPO=站点所在 git 仓库，解析不到就降级）
tests/gui_api_test.py  起真实服务的 Python 回归（含临时 git 仓库的 PR 集成用例）
tests/gui_dom_test.js  M2 前端 DOM 冒烟
```

关键约束（踩线即 bug，详见 `AGENTS.md` §6 写作台红线）：

- Rust **不写 UI、不重写引擎**；解析/渲染/契约/构建全走 `engine/`；
- 路径白名单 `realpath ⊆ site/content/** ∪ site/theme/**`，否则 403；
- 保存：UTF-8 **无 BOM**、LF、末尾换行，保存前跑契约，**422 不写盘**；带 `base_hash` 时磁盘被改过 **409 不覆盖**；
- 令牌只走环境变量/内存/系统钥匙串，两侧日志都 `redact()`；localStorage **不含令牌**；
- 新拼 href/src 必须过 `urls.safe_url()`（Python） / `safeUrl()`（JS，M3 新增，白名单同口径）；
- PR：永不 `--force`、永不推 master、失败给 `compare_url + commands`、不自动重试。

## 5. 已知问题 / 未修项（移交时请注意）

1. **M3 新页的 DOM 冒烟用例没有并入 `tests/gui_dom_test.js`**：hy4 的文件所有权清单
   （用户消息与 `docs/GUI-M3-PROMPT.md`）只列了 `tests/gui_api_test.py`，没有 `gui_dom_test.js`。
   已按提示词的升级规则记录在此：M3 期间用临时脚本验证过 42 项（见 §3），
   **把用例并入 `gui_dom_test.js` 需要所有权确认后再做**（脚本模式：见该文件头部注释与
   `tests/dom-stub.js`；注意桩不反射 `hidden`/`disabled`/`checked` 属性，断言要用
   `getAttribute`，页面识别走 `detectPage()` 的特征元素兜底）。
2. **SML 文件转草稿做不了**：`POST /api/doc` 的 SML 路径只接受整篇 `raw`，前端会把
   `draft: true` 按原文写回，所以 `ctxDraft` 对 `.sml` 明确提示「M2 未做 SML 字段写回」。
   要做：解析 SML → 改 `draft` 键 → 重新序列化（注意 builtin/native 双后端差异）。
3. **重命名不改站内引用**：`/api/rename` 只 `git mv`，正文里手写的 `#/post/<slug>` 之类
   不会自动更新。文档已说明；要做请加「引用扫描 + 确认」。
4. **`whoami` 惰性验证**：重启后从钥匙串恢复的令牌在第一次 `whoami` 时才联网核对，
   过期则 401 提示重新登录（不静默失败）。没有做定期刷新。
5. **`purge` 的「日志」项是说明性的**：本 App 日志只进终端、不落盘，因此没有文件可清；
   「预览与构建缓存」目录当前引擎不写，条目存在时清、不存在时如实说明。
6. **fork 兜底的就绪等待是轮询**（最多 15 秒）：Gitee 没有 webhook，失败会给 stage + 命令。
7. **PowerShell 环境下偶发 `System.AccessViolationException`（AMSI）**：与本仓库代码无关，
   命令重试即可；M3 期间遇到约 4 次。
8. **`git()` 必须保持 `encoding="utf-8"`**：Windows 默认 GBK 会把中文分支名/提交信息解成
   `UnicodeDecodeError`，且症状是管道线程炸掉后 `out.stdout` 变 `None`（报莫名其妙的
   AttributeError）。改这段前先读 `engine/gui_api.py` 里 `git()` 的注释。
9. 字体告警「缺 brotli，子集改用 woff」是环境缺包，不影响结论（`rep.warn` 不进退出码）。
10. **`AGENTS.md` 有两处过期描述没改**（不在 hy4 所有权清单）：目录索引里
    `src/session.rs 令牌脱敏（M3 加钥匙串 / Gitee 校验）`、`src/desktop.rs …（M3 接 Tauri）`
    ——两者均已在 M3 落地，改 AGENTS.md 需要所有权确认。

## 6. 下一步（M4 候选，按依赖顺序）

1. 把 M3 新 UI 的 DOM 冒烟用例并入 `tests/gui_dom_test.js`（等所有权确认，见 §5.1）；
2. `/api/ai-summary`（`engine/ai_summarize.py` 已实现，接进来替掉 501）；
3. SML 字段写回（草稿切换）+ 重命名的引用扫描确认；
4. 登录态过期自动刷新 / PR 创建后的状态回显（不做 CI 面板，跳 Gitee）；
5. Tauri 打包分发（`tauri build` 出安装包；需要补各尺寸图标与签名，当前只有 32px ico）。

## 7. 测试怎么写才有意义（经验）

- Python 侧起**真实服务**（`engine/gui.py --port 0`），用临时站点目录，别碰真实 `site/content`；
  跑 PR 流程要**另起一个临时 git 仓库**（`git init` + `--site` 指进去），断言到 push 失败为止
  （无 remote），并检查分支/提交确实生成、`commands` 里没有 `--force`；
- 未登录用例要用**真实仓库的 `git status` 做金丝雀**：调用前后必须一致；
- 前端用 `tests/dom-stub.js` + 假 `fetch`；DOM 桩没有 `remove()`/`dataset`/冒泡，
  断言优先 `class` / `textContent` / `children.length`；`onclick` 属性要手调；
- 桩不反射 `hidden`/`disabled`/`checked` 属性到 property——应用侧用
  `setHidden()/setDisabled()` 双写，测试侧用 `getAttribute` 断言；
- 写一条就删一条临时文件（`finally` 里清理），否则会污染同进程后面的用例。
