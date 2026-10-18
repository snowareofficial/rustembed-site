# 写作台实现说明（M1）

> 配套：`docs/GUI.md`（设计）、`docs/GUI-FLOWS.md`（交互）、`docs/GUI-IMPLEMENT-PROMPT.md`（任务书）。
> 本文件只写**已经落地**的东西：结构、接口、纪律，以及与 `docs/gui-mock/` 的差异。
> 分期：M1（本文件）→ M2（编辑器全覆盖 / 资源附件 / 改动标记）→ M3（登录 / 钥匙串 / PR / 设置 / Tauri）。

## 1. 结构与职责

```
Cargo.toml                  [workspace] members=["gui"] resolver="2"
gui/                        crate rec-blog-gui，二进制 rec-blog
  src/args.rs               参数解析（含单测）
  src/engine.rs             引擎目录发现、python>=3.11、GUI_PORT= 握手解析（含单测）
  src/assets.rs             include_dir!("assets") + 静态路径白名单（含单测）
  src/server.rs             axum：静态托管 + /api/* 反代（注入 X-GUI-Token）
  src/session.rs            令牌脱敏（M3 加钥匙串 / Gitee 校验）
  src/desktop.rs            --features desktop 的原生窗口（M3 接 Tauri）
  assets/                   内嵌 UI：index.html / style.css / app.js / api.js
engine/gui.py               入口：--port/--site、GUI_TOKEN、打印 GUI_PORT=<n>
engine/gui_api.py           API 业务：类型/树/读取/保存/校验/预览/新建/状态
tests/gui_api_test.py       起真实服务的回归（10 条）
```

**边界**：Rust 只做参数、引擎发现、进程守护、静态托管、反代、打开浏览器；
解析 / 渲染 / 契约 / 构建全部走 `engine/`（`build.render_body`、`contract.validate`、
`markdown.split_front_matter`、`sml.load_doc`），没有重写任何一处。

## 2. 启动流程（实测）

```
rec-blog --site <仓库根或站点目录> [--port N] [--no-open] [--desktop]
  → classify：<p>/content 且 <p>/engine/gui.py → 站点即仓库根；<p>/site/content → 仓库根
  → python3 --version >= 3.11（回退 python）
  → spawn python3 engine/gui.py --port 0（GUI_TOKEN 走环境变量；REC_BLOG_SITE 也是环境变量，都不进 argv）
  → 读 stdout 的 GUI_PORT=<n>（超时 60s；失败时打印引擎 stderr 尾部）
  → axum 起在 127.0.0.1:<随机>；/api/* 反代并注入 X-GUI-Token
  → 打开浏览器（--no-open 不打开）；Ctrl+C 退出时 kill Python 子进程
```

`--site` 三种来源：`--site` > `REC_BLOG_SITE` > `~/.local/share/rec-blog/repo`
（Windows 用 `LOCALAPPDATA`）。默认目录不存在时 `git clone --depth 1` Gitee，
失败给人话错误 + 手动下载提示，不进主界面。

其它命令：`rec-blog --version`（crate 版本 + 引擎 commit）、`rec-blog update`
（`git pull --ff-only` + 提示 `cargo install --force --git ...`）。

## 3. API（M1 已实现）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/types` | 类型 → 契约字段（name/type/required/options/default/doc），字段来自 `contract.describe` 与契约原文 |
| GET | `/api/tree?type=&q=` | `[{type,id,title,path,draft,ext,mtime}]` |
| GET | `/api/doc?path=` | `{path,type,contract,ext,front_matter,body,raw,mtime}` |
| PUT | `/api/doc` | `{path,front_matter,body}` 或 `{path,raw}`（SML 原文）；先校验，422 不写盘 |
| POST | `/api/validate` | `{ok,errors:[{field,code,msg}]}`；`field` 从契约报错里抠出来，前端定位到控件 |
| POST | `/api/preview` | `{html,toc,words}`；与 `build.render_body` 同源，并复用 build 的 video/assets 后处理 |
| POST | `/api/new` | `{type,title,slug,author,tags,draft}` → `{path,template,written:false}` |
| GET | `/api/status` | `{branch,dirty:[{path,status}]}`（`git status --porcelain -uall`，`??`→U） |

未实现的 `/api/asset`、`/api/resources`、`/api/delete`、`/api/pr`、`/api/ai-summary`
返回 **501 + 说明**，不假装成功（M2/M3）。

**纪律**：
- 路径白名单：`realpath` 必须落在 `site/content/**` 或 `site/theme/**`，否则 **403**；
- 保存：`BOM(U+FEFF) 全部去掉` → `\r\n→\n` → 末尾补换行 → `utf-8` 写入；
- 令牌：只用于比对 `X-GUI-Token`，两处日志都做脱敏（`***`），不落盘、不进 argv/URL。

## 4. UI 与 `docs/gui-mock/` 的差异（逐条）

一致：三栏 15rem/自适应/24rem、顶栏 3.5rem、底栏 2rem、视觉令牌（亮暗两套）、
契约绿点+倒三角弹层、分支 chip、标题行 + 审核人/`→ master` chip、
元数据 `<details>` 默认收起为一条摘要、右栏「待生成/生成中/已生成 · 时间/失败」。

差异（都是有意的）：

| 项 | 差异 | 原因 |
|---|---|---|
| 图片槽位 `.slots` | **不做** | 已定决策 7：拖进正文或工具条插入，自动存 assets/（M2） |
| 块面板 `.blocks` 常驻 | **不做** | 已定决策 8：收进「插入」菜单（M2） |
| 编辑器工具条 | M1 只放提示文字，不放按钮 | 工具条是 M2；M1 先把「打开→编辑→保存→预览」跑通 |
| 「提交 PR」「设置」按钮 | 渲染但 `disabled`，tooltip 写「M3 提供」 | 需登录与钥匙串，M3 才接通 |
| 正文输入 | `<textarea class="editor-body">` | mock 是静态示意 div；真实编辑需要可输入的控件 |
| 登录页 / 设置页 | M1 未落地（`login.html`/`settings.html` 留空路由位） | M3 |
| 状态栏「构建 ✓」 | M1 没有 | 不做 CI/部署面板（非目标） |
| 新建 | 弹层内 7 类卡片 + 路径预览 + slug 校验 + 草稿；**创建不落盘** | 对齐 mock 文案「首次保存时写入文件」 |

## 5. 分期状态

- **M1（已完成）**：启动、内容树、打开、契约表单（默认收起）、Markdown 编辑、
  保存/校验、手动预览、新建、草稿。
- **M2**：`/api/asset` + 拖入、工具条 + 插入菜单（`:::xxx` / SML 裸块）、
  `/api/resources` + 资源选择弹层（引用 id / 复制独立附件）、`build.py` 解析
  `Attachment.resource` + 附件卡提取码复制 + `check.py` 不变量、M/U/D 徽标、
  右键菜单、`/api/delete`、外部改动检测、写入前确认弹层。
- **M3**：登录/钥匙串/清除痕迹、`/api/pr`（fork 兜底，永不 force / 永不推 master）、
  设置页、`--features desktop` 的 Tauri（**必须实跑并贴结果**）。
