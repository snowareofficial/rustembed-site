# 实现提示词：rec-blog 写作台（GUI）

> 交给 coding agent 的完整任务书。先读 `AGENTS.md`、`docs/GUI.md`、`docs/gui-mock/*`，
> 再动手。**UI 以 `docs/gui-mock/` 的 HTML/CSS 为准**（可复制进 `gui/assets/` 再改成模板）。

## 0. 目标

在 `rec-blog` 仓库内新增一个「写作台」：

- 本地 Web GUI（浏览器或 Tauri 窗口），覆盖：内容树、契约表单、Markdown 编辑、手动预览、
  保存/校验、新建、草稿、资源当附件、提取码复制、登录/清除痕迹；
- **Rust 只做外壳与系统能力**（cargo 安装/更新、内置静态资源、进程守护、钥匙串、打开窗口/浏览器）；
- **UI 不写成 Rust**：HTML/CSS/JS（vanilla，零构建）；
- **引擎仍是 Python**：解析/渲染/契约/构建/AI 都由现有 `engine/` 完成，不重写。

## 1. 仓库现状（必读）

- Python 引擎：`engine/cli.py`（`new/list/assets/build/check/test/preview`）、`engine/lib/{render,markdown,sml,contract,mindmap,summary}.py`；
- 内容：`site/content/{posts,topics,members,projects,resources,weekly,pages,contracts}`；
- 契约：`site/content/contracts/blog.sml`（**已加** `Attachment.code/resource`、`Resource.folder/code`）；
- 主题：`site/theme/{index.html,app.js,style.css}`（hash 路由 SPA，零构建）；
- 测试：`engine/test_contracts.py`、`engine/test_render_safety.py`、`engine/test_structure.py`、`tests/smoke.js`、`tests/browser-check.js`；
- 构建：`python engine/cli.py build --offline`；产物 `dist/`；发布走 GitHub `pages` 分支 → Cloudflare Pages。

**硬约束**：不引入 pip 依赖（fontTools 已 vendored）；不破坏现有测试；不要求 Node 构建。

## 2. 架构

```
cargo install rec-blog-gui  →  二进制 rec-blog
        │
        ├─ 内嵌 Web UI（include_dir!，来自 gui/assets）
        ├─ 本地 HTTP 服务（axum，127.0.0.1:随机端口）
        │     ├─ 静态资源 /
        │     └─ /api/* 反代到 Python 引擎（同源，无 CORS）
        │
        ├─ 启动 Python 引擎：python3 engine/gui.py --port 0 --token <random>
        │     （stdout 握手 `GUI_PORT=xxxxx`；Rust 读到后开始服务）
        │
        ├─ 钥匙串：token 只进系统钥匙串或内存（绝不落盘明文）
        └─ 可选 feature `desktop`：用 Tauri 打开原生窗口；默认打开浏览器
```

### 2.1 cargo 安装 / 更新

根目录新增 workspace：

```toml
# Cargo.toml（仓库根）
[workspace]
members = ["gui"]
resolver = "2"
```

```bash
cargo install --git https://gitee.com/rustembed/site --branch master rec-blog-gui
cargo install --force --git https://gitee.com/rustembed/site --branch master rec-blog-gui  # 更新
```

- 二进制名 `rec-blog`（`gui/Cargo.toml` 的 `[[bin]]`）；
- `rec-blog --version` 打印 crate 版本 + 引擎 commit（读 `git -C <site> rev-parse --short HEAD`）；
- `rec-blog update`：对引擎目录 `git pull --ff-only`，然后提示重装命令；
- 启动参数：`--site <path>`、`--port <n>`（默认 0）、`--no-open`、`--desktop`（feature 开启时）。

### 2.2 引擎目录发现

优先级：`--site` > 环境变量 `REC_BLOG_SITE` > `~/.local/share/rec-blog/site`。

首次运行若无引擎目录：

```bash
git clone --depth 1 https://gitee.com/rustembed/site.git <dir>
```

（失败则提示手动下载 zip；不要静默失败。）

启动前检查 `python3 --version >= 3.11`，不满足给出人话错误。

## 3. Rust 侧（`gui/`）

依赖建议：`clap`、`tokio`、`axum`、`tower-http`（仅 trace/limit，可省）、`include_dir`、
`serde`、`serde_json`、`anyhow`、`keyring`、`rand`、`open`；可选 `tauri`（feature `desktop`）。

职责：

1. 解析参数、找引擎、起 Python 子进程（继承 stdout/stderr 便于日志）；
2. 读握手行拿端口；启动 axum；`/` 返回内嵌 `index.html`，静态文件按路径返回；
3. `/api/*` 反代到 `http://127.0.0.1:<python-port>/api/*`，注入 `X-GUI-Token`（Rust 生成，Python 校验）；
4. 登录：`POST /api/session` 收到 token 后，先调 Gitee `GET /user?access_token=` 验证；
   成功则写钥匙串（失败则仅内存），返回登录名；**token 不写文件、不进日志**；
5. 清除痕迹：删除钥匙串条目、清 `~/.cache/rec-blog`、清日志；返回清除了哪些项；
6. 退出时杀掉 Python 子进程（Windows 用 job object / `Child::kill`）。

**不要**在 Rust 里实现渲染、契约、Markdown 解析——全部走 Python API。

## 4. Python 侧（`engine/gui.py` + `engine/gui_api.py`）

只用标准库（`http.server` 或 `wsgiref` 均可；不要 Flask/FastAPI）。
监听 `127.0.0.1:--port`，校验 `X-GUI-Token`；打印 `GUI_PORT=<port>` 后开始服务。

### 4.1 API（JSON）

| 方法 | 路径 | 入参 | 出参 |
|---|---|---|---|
| GET | `/api/types` | – | `[{type, contract, fields:[{name,type,required,options}]}]`（读契约生成） |
| GET | `/api/tree` | `?type=` | `[{type,id,title,path,draft,mtime}]` |
| GET | `/api/doc` | `?path=` | `{path,type,front_matter,body,raw}` |
| PUT | `/api/doc` | `{path,front_matter,body}` | `{ok,errors:[{field,msg}]}`（保存前校验；UTF-8 无 BOM、LF） |
| POST | `/api/validate` | `{path?,front_matter,body}` | `{ok,errors}` |
| POST | `/api/preview` | `{path?,front_matter,body}` | `{html,toc,words}`（复用 `render`/`markdown`） |
| POST | `/api/new` | `{type,title,slug,author,tags,draft}` | `{path}`（复用 `cli.py new` 的模板） |
| POST | `/api/asset` | multipart 或 `{name,data_base64}` | `{path,width,height,markdown}` |
| GET | `/api/status` | – | `{branch,dirty:[{path,status}]}`（`git status --porcelain`） |
| POST | `/api/delete` | `{path}` | `{ok}`（`git rm`，仅管理员；二次确认在 UI） |
| GET | `/api/resources` | `?q=` | `[{id,title,kind,folder,url,code,tags}]` |
| POST | `/api/pr` | `{paths,title,body,reviewers,branch}` | `{branch,commit,pr_url?,compare_url?,pushed}` |
| POST | `/api/ai-summary` | `{path}` | `{one_line,points,keywords,source}`（可选，失败 4xx） |

约定：

- 所有写接口先校验契约；错误返回 422 + `errors`；
- 路径白名单：只允许 `site/content/**`、`site/theme/**`（`realpath` 必须落在 site 下）；
- 保存：`text.replace("\r\n","\n").lstrip("\ufeff")`，末尾补一个换行；
- 预览：与构建走同一渲染函数，保证一致；
- `pr`：`git checkout -b <branch>` → `git add <paths>` → `git commit` → `git push origin <branch>`
  → Gitee API `POST /repos/{owner}/{repo}/pulls`（`head/base/title/body/assignees`）；
  **永不 force、永不推 master**；无 token/失败时返回 `compare_url` 与命令。

### 4.2 资源引用解析（engine 改动）

`build.py` 里构造 attachments 时：若 `resource` 字段存在，按 id 在 resources 中查找，
用其 `url`/`title`/`code` 填充（找不到则报错）；`Attachment.code` 原样保留。
站点前端 `app.js` 的附件卡显示「提取码 xxxx · 复制」，点击复制并 toast；
资源列表同样显示提取码复制。

## 5. UI 规格（以 `docs/gui-mock/` 为准）

- 三栏：左树 / 中编辑 / 右纯预览；左右可收起；顶栏 3.5rem、底栏 2rem；
- 顶栏：品牌、类型选择、**契约绿点+倒三角弹层**、分支 chip、右侧动作（确认写入/预览/提交 PR/设置）；
- 动作默认**只显示 SVG 图标**（tooltip），设置里可开「显示按钮文字」；
- 标题行右侧：审核人 chip、`→ master` chip；
- **元数据默认收起**为一条摘要，点开展开契约表单；
- 编辑器：工具条在编辑器内部（粗体/斜体/代码/链接/图片/视频/公式/列表/表格/引用），
  另加「插入」菜单（标题、附件、分割线、面板、步骤、提示、图集、词条）；
  图片拖入正文 → 自动存 `assets/` 并插入 Markdown；
- **手动预览**：点顶栏「预览」才渲染；右栏显示「待生成/已生成」；
- 左树：草稿单独分组；条目显示 `M/U/D` 改动徽标（来自 `/api/status`）；
  右键菜单：打开/重命名/转草稿/复制链接/删除（删除仅管理员，二次确认）；
- 登录页：令牌 + 「记住（系统钥匙串）/ 仅本次会话」；设置页「清除登录痕迹」；
- 设置页：外观（主题/按钮文字/侧栏/字号）、编辑（自动保存、预览手动/自动、图片）、
  资源（提取码显示/点击复制/引用方式）、关于（版本/引擎 commit/运行方式）；
- 资源选择弹层：搜索、类型/文件夹筛选、提取码 `复制`、引用 id 或复制为独立附件；
- 视觉令牌与站点一致（`--paper/--ink/--accent` 等，亮暗两套，见 `docs/gui-mock/style.css`）。

## 6. 行为细节

- **保存**：无 BOM、LF、末尾换行；保存前跑契约；失败不写；
- **改动跟踪**：打开时记内容 hash，输入即 dirty；磁盘被外部改动（hash 变）→ 提示重载/覆盖；
- **草稿**：`draft: true`，构建期跳过（引擎已实现）；取消勾选即参与构建；
- **新建**：类型 → 标题/slug/作者/标签 → 路径预览 → 创建并打开；slug 冲突报错；
- **删除**：`git rm` + PR；作者只看到「转草稿」；
- **登录**：token 仅钥匙串或内存；禁止明文；清除痕迹要列出清了什么；
- **错误**：契约错误定位到字段；构建/预览失败展示 Python 的 stderr 尾部。

## 7. 测试与验收

必须新增/通过：

```bash
cargo fmt --check
cargo clippy -- -D warnings
cargo test                     # Rust：参数解析、路径白名单、握手解析、钥匙串降级
python engine/test_contracts.py
python engine/test_render_safety.py
python engine/test_structure.py
python engine/cli.py build --offline && python engine/cli.py check
```

GUI 专属测试（`tests/gui_api_test.py`，标准库 `urllib` 起服务即可）：

- 保存带 BOM 的输入 → 落盘无 BOM；
- 非法路径（`../../etc/passwd`）→ 403；
- 契约缺失必填字段 → 422 且不写文件；
- 预览结果与 `engine/cli.py build` 的片段一致（同一篇文章）；
- 资源引用附件：`resource: <id>` 解析出 url/code；
- 无 token 调 `/api/pr` → 明确错误，不执行 git；
- 日志中不出现 token（搜索测试）。

人工验收：

- `cargo install --path gui` 后 `rec-blog` 能起、能打开 UI；
- 新建 → 写 → 预览 → 保存 → `build` 通过；
- 右栏、登录、设置、资源选择与 `docs/gui-mock` 视觉一致（或差异有说明）。

## 8. 非目标（不要做）

- 不做 CI/部署状态面板（后续再说）；
- 不重写引擎到 Rust、不做多用户/数据库；
- 不做逐行 diff/评论（跳 Gitee）；
- 不做自动预览、不做自动提交；
- 不引入 Node 构建链、不引入第三方 CDN。

## 9. 交付

- 代码 + `docs/GUI-IMPLEMENT.md`（实现说明与截图）；
- 更新 `AGENTS.md`：新增 `gui/`、`engine/gui.py` 的职责与约束；
- 所有测试通过，提交信息按仓库习惯（`feat(gui): ...`）。
