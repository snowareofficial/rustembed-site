# 交给 hy4（coding agent）的入口提示词

> 直接把下面整段贴给 coding agent 即可。详细规格在仓库文档里，这段只做「入口 + 红线 + 验收」。

---

你在 `rec-blog` 仓库里实现「写作台 GUI」。仓库根目录：`C:\Users\sakeen\Desktop\rec-blog`。
先读文档，再写代码；**如果文档之间冲突，以 `docs/GUI-IMPLEMENT-PROMPT.md` 为准**。

## 必读（按顺序）

1. `AGENTS.md` —— 仓库约束、双 SML 后端、测试纪律
2. `docs/GUI.md` —— 设计决策（架构、cargo 分发、令牌纪律、资源附件）
3. `docs/GUI-FLOWS.md` —— 全功能交互逻辑（启动/登录/编辑/预览/PR/错误状态机）
4. `docs/GUI-IMPLEMENT-PROMPT.md` —— **详细实现任务书（主规格）**
5. `docs/gui-mock/` —— 视觉基准（`index.html` / `login.html` / `settings.html` / `attach.html` / `style.css`）

## 任务

新增两部分：

1. **Rust 启动器**：`gui/`（crate 名 `rec-blog-gui`，二进制 `rec-blog`）
   - `cargo install --git ... rec-blog-gui` 可安装；`--force` 即更新；
   - 内嵌 Web UI（`include_dir!`）、本地 axum 服务、`/api/*` 反代；
   - 启动并守护 `python3 engine/gui.py`（用环境变量 `GUI_TOKEN` 传会话密钥，不放 argv）；
   - 钥匙串（keyring）、打开浏览器；`--features desktop` 时用 Tauri 系统 WebView；
   - **Tauri 必须实测**：M3 跑 `cargo check/build --features desktop` 并贴结果；
     失败记录完整错误，不得以「不保证」跳过。
   - `rec-blog update` 拉引擎并提示重装。
2. **Python API**：`engine/gui.py` + `engine/gui_api.py`
   - 只用标准库；复用 `engine/lib/{render,markdown,sml,contract,mindmap,summary}.py`；
   - 提供 types/tree/doc/save/validate/preview/new/asset/status/delete/resources/pr 接口（见任务书第 4 节）；
   - 路径白名单：只允许 `site/content/**`、`site/theme/**`；
   - 保存：UTF-8 无 BOM、LF、末尾换行，保存前跑契约。

此外：`tests/gui_api_test.py`、更新 `AGENTS.md`。

## 红线（违反即返工）

- **Rust 不写 UI**：界面是 HTML/CSS/JS（从 `docs/gui-mock/` 改造），不引入 Node 构建链、不引 CDN。
- **引擎仍是 Python**：不重写渲染/契约/构建；不新增 pip 依赖（fontTools 已 vendored）。
- **令牌严禁明文**：只进系统钥匙串或进程内存；不写配置、不进日志/URL/剪贴板历史；日志脱敏。
- **永不 `git push --force`、永不直接推 master**；PR 一律走分支。
- **不做**：CI/部署状态面板、多用户、逐行评论/diff（跳 Gitee）。
- 保存必须无 BOM；内容文件带 BOM 会在 CI 的 builtin 后端解析失败。

## 分期（每期都要能跑）

- **M1**：启动、内容树、打开、契约表单（默认收起）、Markdown 编辑、保存/校验、手动预览、新建、草稿。
- **M2**：图片拖入、工具条 + 插入菜单（含 SML 块）、资源当附件（引用 id / 复制）、提取码复制、右键删除、`M/U/D` 改动标记。
- **M3**：登录/钥匙串/清除痕迹、提交 PR（含 fork 兜底）、设置页。

## 验收（必须全绿）

```bash
cargo fmt --check
cargo clippy -- -D warnings
cargo test
python engine/test_contracts.py
python engine/test_render_safety.py
python engine/test_structure.py
python tests/gui_api_test.py
python engine/cli.py build --offline && python engine/cli.py check
```

人工验收：

- `cargo install --path gui` 后 `rec-blog` 能起、能打开 UI；
- 新建 → 写 → 预览 → 保存 → `build` 通过；
- 令牌不出现在任何文件/日志；
- 页面与 `docs/gui-mock` 一致或差异有说明。

## 工作方式

1. 先输出**实现计划**（文件清单 + 分期 + 风险），等我确认再写代码；
2. 每期结束跑上面验收命令，把结果贴出来；
3. 提交信息用 `feat(gui): ...` / `feat(engine): ...`，不要一个 giant commit；
4. 发现规格问题：先改 `docs/GUI-IMPLEMENT-PROMPT.md`，再改代码，并在提交里说明。
