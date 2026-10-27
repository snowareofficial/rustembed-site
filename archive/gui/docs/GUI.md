# GUI 设计（写作 / 审核 / 发布工作台）

> 状态：设计稿 v2（按 2026-10-19 的四个决定修订）
> 决定：**本地 Web GUI** / **覆盖整个 demo 的内容类型** / **提交 PR 给审核人** / **SML 块级表单**。
> 编辑体验参考 PVACIS 的 UGC 文档流程（`PVACIS/Docs/SPEC-2026-09-14-UGC-DOC-FLOW.md`）。

## 1. 定位

| 项 | 结论 |
|---|---|
| 形态 | 本地 Web GUI：`python engine/gui.py` → `127.0.0.1:8788`，浏览器打开 |
| 用户 | 作者（写稿/预览/提 PR）+ 审核人（看 diff/评论/合并，在 Gitee 侧） |
| 覆盖 | 文章、词条、成员、项目、资源、周报、站文档、契约、站点配置 |
| 不做 | 在线多用户、数据库、WYSIWYG、云端图床 |
| 依赖 | Python 3.11+ 标准库；前端零构建（vanilla JS） |

## 2. 编辑流程（参考 PVACIS）

```
① 选类型/新建
      ↓
② 写正文（Markdown 默认；可切 SML）
      ↓
③ 图片槽位：空槽 = 占位 SVG + 灰色 ×；拖入/点选 → 存 assets/ → 解析尺寸
      ↓
④ 待写入内容确认（关键步骤，与 PVACIS 一致）
   · 展示将要写入的字段/块（来源：表单 / 解析 / 自动生成）
   · [全部写入] [选择性写入（逐项勾选）] [取消]
      ↓
⑤ 保存（UTF-8 无 BOM / LF）→ 契约校验 → 实时预览
      ↓
⑥ 提交 PR：新分支 → commit → push → Gitee PR（指派审核人）
```

这一套的意义：**写用 Markdown，存用 md 或 SML**；结构化块由表单生成，但写入前一定让人
看到"到底要写什么"，可以挑着写或整体取消——避免自动解析/自动补全把内容写坏。

## 3. 界面骨架

```
┌───────────────────────────────────────────────────────────────────────┐
│ 站点名 │ 类型: 文章 ▾ │ 契约 ✓ │ [确认写入] [预览] [提交 PR] │ 设置     │
├──────────────┬─────────────────────────────────┬──────────────────────┤
│ 内容树        │ 表单区（按类型/契约生成）        │ 预览 + 检查器         │
│ ▾ 文章 2026  │ title / author / date / tags …  │ 渲染后的正文           │
│ ▾ 词条       │ 图片槽位（拖入）                 │ 目录 / 字数 / 附件     │
│ ▾ 成员       │ 正文：Markdown / SML 块编辑器     │ 契约错误（定位到字段）  │
│ ▾ 项目 …     │ [块面板] 段落 代码 图片 视频 …    │ PR 预览（分支/审核人）  │
├──────────────┴─────────────────────────────────┴──────────────────────┤
│ 路径 · 字数 · 保存状态 · 构建状态 · 日志抽屉                            │
└───────────────────────────────────────────────────────────────────────┘
```

- 左：内容树（类型 → 年份/分组 → 条目；搜索、草稿标记）
- 中：**按契约生成的表单** + **SML 块编辑器**（块面板插入/拖排序，每块一个小表单，可切原文）
- 右：手动预览（点按钮才渲染，复用 `render`/`markdown`）、检查器、PR 信息

## 4. 内容类型覆盖（整个 demo）

| 类型 | 目录 | 表单来源 | 预览路由 |
|---|---|---|---|
| 文章 | `content/posts/<年>/[系列/]<短名>/` | `BlogPost` 契约 | `#/post/<slug>` |
| 词条 | `content/topics/` | `Topic` | `#/topic/<id>` |
| 成员 | `content/members/` | `Member` | `#/member/<id>` |
| 项目 | `content/projects/` | `Project` | `#/project/<id>` |
| 资源 | `content/resources/` | `Resource` | `#/resources` |
| 周报 | `content/weekly/` | `Weekly` | `#/weekly/<id>` |
| 站文档 | `content/pages/` | `Page` | `#/page/<id>` |
| 契约 | `content/contracts/` | 只读查看 + 校验 | `#/page/contracts` |
| 站点配置 | `content/site.sml` | 结构化表单（导航/群信息/公告） | `#/home` |

表单字段直接由 `engine/lib/contract.py` 读取契约生成（类型、必填、枚举、默认值），
**不在前端重复定义字段**，避免和契约漂移。

## 5. SML 块编辑器

- 块面板：段落 / 标题 / 列表 / 引用 / 代码 / 图片 / 表格 / 公式 / 提示 / 面板 / 步骤 / 图集 / 词条 / 视频 / 附件
- 每块一个表单（字段与 `lib/render.py` 的块类型对齐）；支持上移/下移/删除/复制
- 任何块都能切「原文」直接编辑；保存前用 `render` 渲染一遍，失败定位到块
- 未知块保留原文，不丢内容（保证向前兼容）

## 6. 提交 PR（不直接推 master）

```text
新分支：post/<slug>-<yyyymmddHHMM>   （或 edit/<type>-<id>-…）
提交：  git add <改动文件> && git commit -m "<类型>: <标题>"
推送：  git push origin <branch>            # 仅分支，不 force
建 PR： Gitee API POST /repos/{owner}/{repo}/pulls
        head=<branch> base=master title=… body=… assignees=<审核人列表>
```

- 审核人名单：`site/content/site.sml` 新增 `reviewers: [id1, id2]`（或环境变量覆盖）
- PR 描述自动带：类型、变更文件、契约/构建结果、预览截图（可选）
- **没有 token / 网络失败**：不假装成功，给出 `git push` 命令 + Gitee 新建 PR 的对比链接
- 永不 `--force`；永不直接推 `master`

## 7. 技术方案

```
engine/gui.py          # stdlib http.server，127.0.0.1:8788，单进程
engine/gui_api.py      # 路由 + 业务（复用 build/render/contract/cli/git）
gui/assets/        # index.html / app.js / style.css（零构建）
```

API：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/types` | 类型 → 契约字段（表单 schema） |
| GET | `/api/tree?type=` | 内容树 |
| GET | `/api/doc?path=` | 读取（front matter + body + blocks） |
| PUT | `/api/doc` | 保存（校验 + 无 BOM） |
| POST | `/api/validate` | 契约校验 |
| POST | `/api/preview` | 渲染预览（返回 HTML + 目录） |
| POST | `/api/asset` | 上传图片到 `assets/`，返回尺寸与插入片段 |
| POST | `/api/blocks/parse` | SML 正文 ↔ 块结构互转 |
| POST | `/api/pr` | 建分支/提交/推送/建 PR（返回 PR URL 或命令） |
| POST | `/api/build` | 构建 + 自检，返回日志 |
| GET | `/api/config` | 站点/审核人/是否配置 token |

## 8. 分期

- **M1**：内容树 + 全类型表单 + 保存/校验 + 实时预览 + 新建（先能写）
- **M2**：图片槽位（拖入/占位/尺寸/插入）+ SML 块编辑器 + 确认写入三出口
- **M3**：构建、PR（分支/提交/推送/审核人）、PR 预览
- **M4**：模板/片段、搜索、快捷键、SML 原文高亮

## 9. 安全与纪律

- 只监听 `127.0.0.1`；写接口带 `X-GUI-Token`（启动时生成，页面注入）
- 路径白名单：只允许 `site/content/**`、`site/theme/**` 的读写
- 上传只收图片，单张 ≤ 2 MB；文件名清洗
- 保存统一 UTF-8 无 BOM / LF（CI 的 builtin SML 不容忍 BOM）
- token 只在内存/环境变量；不写仓库、不进日志

## 10. 验收

- GUI 能新建/编辑/预览/校验全部 9 类内容；
- 保存的文件直接过 `build` + `check` + `test_structure`；
- 提交 PR 后 Gitee 上能看到分支、提交、PR 与审核人；
- 断网时除「PR/AI」外全部可用；
- 与 CLI 结果一致（同一份文件，GUI 保存后 CLI 构建结果不变）。

## 12. 新建与草稿

新建入口在内容树顶部：**[+ 新建]** → 类型卡片（文章/词条/成员/项目/资源/周报/站文档）
→ 标题、短名（slug）、作者、标签 → 路径预览 → 可选「草稿」→ 创建并打开。

- 路径由类型 + 年份 + slug 自动拼出（文章：`posts/<年>/[系列/]<slug>/index.md`，无系列时省略该层）；
- slug 只允许小写字母/数字/连字符，重复会提示；
- **草稿 = `draft: true`**：构建期直接跳过（`build.py` 里 `if d.get("draft") is True: continue`），
  不进站点、不进搜索索引、不进 RSS；左侧树单独「草稿」分组，草稿不参与发布。

## 13. Tauri 与 Web 双形态

**一套前端 + 一套本地 API，Tauri 只做外壳**：

```
桌面（有 Tauri）:  Tauri 启动 → spawn `engine/gui.py --port 0` → webview 打开 127.0.0.1:<port>
浏览器（无 Tauri）: 用户执行 `python engine/gui.py` → 打开同一 URL
```

- 两端**共用同一个 `gui_web/` 和同一个 Python API**，功能不分叉；
- 端口用 0 让系统分配，启动后通过 stdout 握手行读回实际端口；
- 退出 Tauri 时杀掉子进程；端口冲突/防火墙只影响本地回环；
- 打包（可选，M4）：PyInstaller 把 `engine/` + Python 运行时打成 sidecar，
  用 Tauri `externalBin` 带进安装包，用户不需要装 Python；MVP 阶段先要求本机 Python；
- 文件对话框（选图/另存）在 Tauri 里可用原生能力，Web 模式用 `<input type=file>` 兜底。

## 11. 待确认

1. **审核人名单**（Gitee 用户名），我先写进 `site.sml` 的 `reviewers`；
2. Gitee token 放环境变量（`GITEE_TOKEN`）可以吗？还是每次在 GUI 里输入（不落盘）；
3. M1 先做「文章 + 词条 + 成员」三类，还是一次铺满 9 类？

## 14. 补充约定（2026-10-19）

- **按钮文字**：**顶部动作默认显示文字**（确认写入 / 预览 / 提交 PR：不常用且有风险），
  **编辑器工具条默认只显示图标**（手熟、省空间）；设置里两个独立开关，窄屏自动只留图标。
- **内容类型对应**：
  - 「能力与合作」= Service 契约（可新建/编辑）；
  - 「加入我们」「站文档」= Page；
  - 「文章知识」是**派生页**（词条 + 标签 + 系列索引），不落单独文件，不需要编辑。
- **草稿**：就是原文件里的 draft: true，文件仍在 site/content/posts/.../index.md；
  构建期跳过（不进站点/搜索/RSS）。取消勾选 = 参与构建，不需要移动文件。
- **删除**：管理员操作；git rm 文件 + 在 PR 里确认，历史可恢复；作者侧建议用「转草稿」代替删除。

## 15. 删除与改动跟踪

- **删除**：右键菜单（打开 / 重命名 / 转草稿 / 复制站内链接 / 删除），另有 hover「…」与 Delete 键；
  - 作者：只看到「转草稿」，不显示删除；
  - 管理员：删除需二次确认，执行 git rm 并在 PR 中体现（合并前可撤回）；
  - 不物理删历史：git 就是回收站。
- **改动跟踪**（本地、无数据库、无隐藏状态文件）：
  1. 编辑层：打开时记内容 hash；输入即 dirty（树/标题打点）；Ctrl+S 保存；切换/关闭提示；
     磁盘被外部改过（hash 变化）→ 提示「重新加载 / 覆盖」；
  2. Git 层：git status --porcelain 驱动树上 **M/U/D** 标记与状态栏「改动 N · 未提交」；
     保存只写文件，不自动提交；
  3. 提交层：PR 时列出本次改动（可勾选），新建分支提交并推送；PR 描述带 diff stat；
  4. 冲突：pull 前要求工作区干净；冲突不自动覆盖，直接拒绝并提示。

## 16. 登录 / 登出 / 清除痕迹

- **登录**：Gitee 个人令牌（
epo 权限）粘贴登录；二选一存储：
  - 仅本次会话（内存，关掉即失效）；
  - 记住（Windows Credential Manager / macOS Keychain，经 Tauri 插件）。
- **登出**：清内存 token；**清除登录痕迹**单独一个动作，勾选要清的项：
  1. 钥匙串里的 token；2. 最近打开文件；3. 预览/构建缓存；4. 日志；5. 剪贴板（可选）。
  确认框里明示「git 自身保存的凭证不在本 App 管辖范围」。
- 未登录也能**浏览、写作、预览、校验**；只有「提交 PR / 合并」需要登录。

## 17. Rust 的边界

- **Rust 只做外壳与系统能力**：Tauri 窗口、启动/守护 Python 服务、钥匙串、文件对话框、自动更新。
- **UI 仍是 HTML/CSS/JS**：Rust 不参与渲染与布局，避免把界面绑死在 Rust 生态里。
- Python 继续负责引擎：解析、渲染、契约、构建、AI 摘要。
- 可选（后期）：Rust 接管 git 操作（libgit2）以提速，但接口不变。

## 18. 编辑器覆盖 & 资源当附件

原「一排按钮」= 段落/代码/图片/视频/公式/引用/列表/表格 + 粗体/斜体/代码/链接。
新编辑器用 **工具条 + 插入菜单** 全覆盖：

| 原按钮 | 现在 |
|---|---|
| 粗体/斜体/行内代码/链接 | 工具条图标 + 快捷键 |
| 段落/标题 | Enter / # 前缀 / 插入菜单「标题」 |
| 列表/引用/表格 | 工具条 |
| 代码块/公式/图片/视频 | 工具条 + 拖拽 |
| 附件 | 插入菜单「附件」→ 可从资源库选 |
| 面板/步骤/提示/图集/词条（SML） | 插入菜单「结构化块」 |

**资源当附件**：附件支持 
esource: <资源 id>，构建期按 id 解析出 url 与 提取码；
资源改了，附件跟着变（不复制过期链接）。也可「复制为独立附件」（此时固定当时的值）。

**资源文件夹**：不建真实目录（URL 稳定），用可选 older 字段 + kind 分组展示；
没有 older 时按 kind 归组。

**提取码**：Resource.code 可选字段；列表与附件卡都显示 提取码 · 复制，点击写剪贴板并 toast；
构建产物里 data-code 只存值，不自动展示给未点击的人。

## 19. 暂不做（记录）

- CI / 部署状态面板（PR 之后的构建、Cloudflare 发布进度）——M3 之后再评估；
- 在线多人协作、评论/逐行 diff（保留跳 Gitee）。

## 20. 分发：cargo 安装 / 更新

目标：`cargo install` 一条命令拿到可用的写作台，`--force` 即更新。

```bash
# 首次
cargo install --git https://gitee.com/rustembed/site --branch master rec-blog-gui
# 更新（重装即更新二进制）
cargo install --force --git https://gitee.com/rustembed/site --branch master rec-blog-gui
rec-blog update          # 顺带 git pull 引擎（不重编译）
```

结构：

- **crate `rec-blog-gui`，二进制 `rec-blog`**：Rust 启动器 + 内置 Web UI（`include_dir!`）+ 本地 HTTP 服务；
- **UI 不归 Rust**：Rust 只做静态托管、API 反代、进程守护、钥匙串、打开浏览器/窗口；
- **引擎仍是 Python**：`rec-blog` 启动 `python3 engine/gui.py --port 0 --token <random>`，
  读 stdout 握手拿端口，浏览器只访问 Rust 的单一入口（同源、无 CORS）；
- 引擎目录：`REC_BLOG_SITE` 环境变量优先；否则 `~/.local/share/rec-blog/site`
  （首次运行 `git clone --depth 1` Gitee，失败则提示下载 zip）；
- **Tauri 可选**：同一 crate 的 `--features desktop` 打开原生窗口；默认 `cargo install` 是浏览器模式；
- 版本：`rec-blog --version` 打印 crate 版本 + 引擎 commit；`rec-blog update` 拉引擎并提示重装命令。

## 21. 令牌纪律（硬性）

- **严禁明文保存**：不写配置文件、不写日志、不进 URL、不进剪贴板历史、不落仓库；
- 只允许两种位置：**系统钥匙串**（Windows Credential Manager / macOS Keychain / libsecret）
  或**进程内存**（仅本次会话）；
- 钥匙串不可用 → 自动退化为「仅本次会话」，**不得**回退到文件；
- 「清除登录痕迹」必须删除钥匙串条目、最近文件、预览/构建缓存、日志；
  并在界面注明「git 自身保存的凭证不在本 App 管辖范围」；
- 日志与崩溃报告统一脱敏：token 一律替换为 `***`。

## 22. 启动细节与协作模型

- **`--token` 是什么**：Rust 启动器与 Python 引擎之间的**本地 API 会话密钥**（随机生成），
  不是 Gitee 登录令牌。用于拒绝本机其他进程调用写接口。**不要放 argv**（进程列表可见），
  用环境变量 `GUI_TOKEN` 传给 Python 子进程。
- **有没有 WebView**：默认是浏览器模式；Tauri `desktop` feature 用**系统 WebView**
  （Windows WebView2 / macOS WKWebView），不打包 Chromium。
- **PR 要不要 fork**：
  - 有写权限（协作者/维护者）：直接推 `origin` 的同名分支 → PR（head=分支，base=master）；
  - 无写权限（外部贡献者）：API 先 `fork` → 推到自己的 fork → PR `head=<user>:<branch>`；
  - GUI 检测 push 失败（403）时给「Fork 后提交」选项；仍失败则给 compare 链接与命令。
