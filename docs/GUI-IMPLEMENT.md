# 写作台实现说明（M1 + M2 + M3）

> 配套：`docs/GUI.md`（设计）、`docs/GUI-FLOWS.md`（交互）、`docs/GUI-IMPLEMENT-PROMPT.md`（任务书）。
> 本文件只写**已经落地**的东西：结构、接口、纪律，以及与 `docs/gui-mock/` 的差异。
> 分期：M1（能写）→ M2（编辑器全覆盖 + 资源附件 + 改动标记）→ M3（本次：登录 / 钥匙串 / PR / 设置 / Tauri）。

## 1. 结构与职责

```
Cargo.toml                  [workspace] members=["gui"] resolver="2"
gui/                        crate rec-blog-gui，二进制 rec-blog
  src/args.rs               参数解析（含单测）
  src/engine.rs             引擎目录发现、python>=3.11、GUI_PORT= 握手解析（含单测）
  src/assets.rs             include_dir!("assets") + 静态路径白名单（含单测）
  src/server.rs             axum：静态托管 + 登录态接口 + /api/* 反代（按需注入 X-Gitee-Token）
  src/session.rs            令牌脱敏 / 钥匙串（TokenStore 双实现）/ Gitee 校验 / purge / recent
  src/desktop.rs            --features desktop 的 Tauri 原生窗口（系统 WebView）
  build.rs                  desktop 特性下跑 tauri-build
  tauri.conf.json           Tauri 配置（frontendDist=assets，窗口在 setup 里建）
  icons/icon.ico            应用图标（32x32，品牌赭红）
  assets/                   内嵌 UI：index.html / login.html / settings.html /
                            style.css / app.js / api.js（三页共用同一份 app.js）
engine/gui.py               入口：--port/--site、GUI_TOKEN、打印 GUI_PORT=<n>
engine/gui_api.py           API 业务：类型/树/文档读写/校验/预览/新建/图片/资源/删除/重命名/
                            状态/reviewers/PR（Gitee fork 兜底）
tests/gui_api_test.py       起真实服务的回归（23 条：M1 十条 + M2 八条 + M3 五条）
tests/gui_dom_test.js       DOM 冒烟（M2 用例；M3 新页用例见 GUI-HANDOFF.md §5 的所有权说明）
```

**边界**：Rust 只做参数、引擎发现、进程守护、静态托管、反代、登录态（钥匙串/内存）、
原生窗口；解析 / 渲染 / 契约 / 构建全部走 `engine/`（`build.render_body`、`contract.validate`、
`markdown.split_front_matter`、`sml.load_doc`），没有重写任何一处。

## 2. 启动流程（实测）

```
rec-blog --site <仓库根或站点目录> [--port N] [--no-open] [--desktop]
  → classify：<p>/content 且 <p>/engine/gui.py → 站点即仓库根；<p>/site/content → 仓库根
  → python3 --version >= 3.11（回退 python）
  → spawn python3 engine/gui.py --port 0（GUI_TOKEN 走环境变量；REC_BLOG_SITE 也是环境变量，都不进 argv）
  → 读 stdout 的 GUI_PORT=<n>（超时 60s；失败时打印引擎 stderr 尾部）
  → 启动时读一次系统钥匙串：有令牌 → 恢复登录态（whoami 时联网核对），没有/读失败 → 仅本次会话
  → axum 起在 127.0.0.1:<随机>；/api/* 反代并注入 X-GUI-Token
  → 打开界面：--desktop 且编译了 desktop 特性 → Tauri 原生窗口（阻塞到窗口关闭）；
    否则浏览器；--no-open 都不开，等 Ctrl+C
  → 退出：abort axum 任务 + kill Python 子进程
```

`--site` 三种来源：`--site` > `REC_BLOG_SITE` > `~/.local/share/rec-blog/repo`
（Windows 用 `LOCALAPPDATA`）。默认目录不存在时 `git clone --depth 1` Gitee，
失败给人话错误 + 手动下载提示，不进主界面。

其它命令：`rec-blog --version`（crate 版本 + 引擎 commit）、`rec-blog update`
（`git pull --ff-only` + 提示 `cargo install --force --git ...`）。

## 3. API

### 3.1 引擎侧（Python，`engine/gui_api.py`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/types` | 类型 → 契约字段（name/type/required/options/default/doc），字段来自 `contract.describe` 与契约原文 |
| GET | `/api/tree?type=&q=` | `[{type,id,title,path,draft,ext,mtime}]` |
| GET | `/api/doc?path=` | `{path,type,contract,ext,front_matter,body,raw,mtime,hash}` |
| PUT | `/api/doc` | `{path,front_matter,body}` 或 `{path,raw}`（SML 原文）；先校验，422 不写盘 |
| POST | `/api/validate` | `{ok,errors:[{field,code,msg}]}`；`field` 从契约报错里抠出来，前端定位到控件 |
| POST | `/api/preview` | `{html,toc,words}`；与 `build.render_body` 同源，并复用 build 的 video/assets 后处理 |
| POST | `/api/new` | `{type,title,slug,author,tags,draft}` → `{path,template,written:false}` |
| POST | `/api/asset` | `{path,name,data_base64}` → `{path,name,url,markdown,width,height,size}`（≤2 MB、仅图片、魔数校验、sha256 去重） |
| GET | `/api/resources` | `?q=&kind=&folder=` → `[{id,title,kind,folder,url,url_blocked,code,tags,note}]` |
| POST | `/api/delete` | `{path,confirm}`（confirm 必须等于短名）→ `git rm`，未跟踪则退回文件系统删除；**需登录** |
| POST | `/api/rename` | `{path,slug}` → `git mv`（文章连目录一起改名），返回新路径；**需登录** |
| GET | `/api/status` | `{branch,dirty:[{path,status}]}`（`git status --porcelain -uall`，`??`→U） |
| GET | `/api/reviewers` | PR 默认审核人：`REC_BLOG_REVIEWERS`（逗号分隔）优先，否则 `site.sml` 的 `reviewers` |
| POST | `/api/pr` | `{paths,branch,message,title,body,reviewers}`；**需登录**（见 3.3） |

### 3.2 登录态接口（Rust 直处理，不过 Python）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/session` | `{token, remember}`：先调 Gitee `GET /api/v5/user` 验证；成功写钥匙串（remember=true）或只放内存；钥匙串失败 → 明确提示并降级仅内存，**不回退文件**。返回 `{login,name,avatar_url,stored,location,note}` |
| GET | `/api/whoami` | 当前登录；未登录 401。钥匙串恢复的令牌惰性验证一次（过期 → 401 + 请重新登录） |
| DELETE | `/api/session` | 清内存；`?purge=true` 才删钥匙串条目 |
| POST | `/api/purge` | 体可选 `{items:[keyring,memory,recent,cache]}`（空=全部）；逐项返回 `[{item,ok,detail}]`，并注明 git 自身凭证不在管辖范围 |
| GET | `/api/recent` | 最近文件（只存路径，反代 `GET /api/doc` 时记录到 `<data>/rec-blog/recent.json`） |
| GET | `/api/about` | `{version, engine_commit, desktop_feature}`（设置页「关于」） |

### 3.3 /api/pr 的流程与纪律

```
校验：paths 非空且都在 site/content|theme/**（否则 400/403）；
      分支名拒绝 master/main/staging、空格、.. 与 shell/git 元字符（否则 400）；
      先用 GUI 登录的令牌调 GET /user 拿 login（失败 → stage=auth，不建分支）；
执行：git checkout -b <branch> → git add <paths> → git commit -m <message>
      → git push -u origin <branch>（**临时 env 注入令牌**，见下）；
      403/401 → fork 兜底：POST /forks → 轮询就绪 →
                git remote add fork → push fork（同样带 env）→ PR head=<login>:<branch>；
      POST /repos/{owner}/{repo}/pulls {title,head,base:"staging",body,assignees}；
任一步失败 → 200 + {ok:false, stage, error, compare_url, commands}；
成功 → {ok:true, branch, commit, pr_url, reviewers, via, head}。
```

- **目标分支是 `staging`**（`BASE_BRANCH`）：作者 PR 一律进 staging，staging → master
  由维护者合并；标题行 chip、PR body、compare 链接全部指向 staging；
- **永不 `--force`、永不推 master/main/staging、不自动重试、不改历史**；失败时分支与本地提交保留；
- `compare_url` = `<repo_url>/compare/staging...<branch>`，`commands` 用 `shlex.quote`
  逐段转义（路径/提交信息含空格、引号、`$`、反引号时复制进 shell 不会坏）；
- 仓库坐标来自 `site.sml: repo_url`；令牌走 `Authorization: token` 头（不进 URL、不进日志）；
- 站点不在 git 仓库里（`REPO` 解析不到 `.git`）时明确失败并给出手动命令；
  删除/重命名同步降级为文件系统操作（`via: "fs"`）。

**push 的令牌注入（干净机器的关键路径）**：`git()` 多一个只作用于该子进程的 `env` 参数，
push 时传 `_push_env(login, token)`：

```
GIT_CONFIG_COUNT=1
GIT_CONFIG_KEY_0=http.extraHeader
GIT_CONFIG_VALUE_0=Authorization: Basic base64(login:token)
GIT_TERMINAL_PROMPT=0
```

- 不改全局 git 配置、不进 URL、不进 argv；继承来的 `GIT_CONFIG_*` 先清掉再设；
- `GIT_TERMINAL_PROMPT=0`：没有可用凭据时立刻失败，绝不弹密码框（否则干净机器上会卡在交互）；
- `GIT_CONFIG_COUNT` 系列**需要 git ≥ 2.31**（2021-03 发布；更老的 git 会忽略它，
  表现是退回本机凭据/直接失败，不会泄 token）；
- `http.extraHeader` 对该次 push 里 git 访问的任何 http 主机都生效（env 只活这一个进程）；
- fork 的 push 走同一条路；测试用「本地裸仓库 + 记录请求头的本地 http 服务」验证：
  env 构造、git 真的发出 `Authorization: Basic …` 头、令牌不进 URL/argv/返回内容。

### 3.4 反代与令牌注入

- 所有 `/api/*` 都注入 `X-GUI-Token`（进程间密钥）；
- **只有** `/api/pr`、`/api/delete`、`/api/rename` 注入 `X-Gitee-Token`（`server.rs::needs_gitee_token`，纯函数有单测）；
- Python 只读 `X-Gitee-Token`：不落盘、不进日志、不回显；未登录 → 401 且不执行任何 git。

**其它纪律**：
- 路径白名单：`realpath` 必须落在 `site/content/**` 或 `site/theme/**`，否则 **403**；
- 保存：`BOM(U+FEFF) 全部去掉` → `\r\n→\n` → 末尾补换行 → `utf-8` 写入；
- **外部改动检测**：`GET /api/doc` 返回 `hash`；`PUT /api/doc` 带 `base_hash` 时先比对，不一致 → **409 E-CONFLICT，不写盘**；
- `git()` 一律 `encoding="utf-8"`：Windows 默认 GBK 会把中文提交信息解成 `UnicodeDecodeError`（管道线程炸掉、stdout 变 None，M3 实测踩坑）；
- 设置存 localStorage 的 `rec-blog-gui-prefs`，**不含令牌**；令牌只进钥匙串或进程内存。

## 4. UI 与 `docs/gui-mock/` 的差异（逐条）

一致：三栏 15rem/自适应/24rem、顶栏 3.5rem、底栏 2rem、视觉令牌（亮暗两套）、
契约绿点+倒三角弹层、分支 chip、标题行 + 审核人/`→ master` chip、
元数据 `<details>` 默认收起为一条摘要、右栏「待生成/生成中/已生成 · 时间/失败」、
登录页与设置页的卡片式布局（`login.html` / `settings.html` 由 mock 改造）。

差异（都是有意的）：

| 项 | 差异 | 原因 |
|---|---|---|
| 图片槽位 `.slots` | **不做** | 已定决策 7：拖进正文或工具条「图片」插入，自动存 assets/ |
| 块面板 `.blocks` 常驻 | **不做** | 已定决策 8：收进「插入」菜单 |
| 编辑器工具条 | 默认只图标（设置里可开文字） | 已定决策 6；M3 落地两个文字开关 |
| 正文输入 | `<textarea class="editor-body">` | mock 是静态示意 div；真实编辑需要可输入的控件 |
| 登录 / 设置 | **独立页面** `/login`、`/settings`，与 index 共用一份 `app.js`（按 `data-page`/特征元素分发） | mock 同形态；token 只走 `/api/session`，设置页不碰令牌 |
| 「提交 PR」按钮 | 未登录置灰（tooltip「登录后可用」），登录后可用 | M3：写操作三件套要登录（登录=本地管理员，细粒度权限留给平台） |
| 「设置」按钮 | 常可用 | 未登录也能看状态/改外观/清痕迹 |
| 状态栏「构建 ✓」 | 没有 | 不做 CI/部署面板（非目标） |
| 新建 | 弹层内 7 类卡片 + 路径预览 + slug 校验 + 草稿；**创建不落盘** | 对齐 mock 文案「首次保存时写入文件」 |
| .sml 契约表单 | 显示为「原文编辑」说明，工具条粗体/斜体改插 `{strong:}`/`{em:}` | M1 只读解析、M2 做原文写回；SML 字段暂不改写（转草稿也会明确提示） |
| PR 弹层 | 改动文件多选（来自 `/api/status`）+ 分支/commit/标题/描述 + 审核人 chips（来自 `/api/reviewers`，可增删） | mock 同形态；失败展示 stage + compare 链接 + 可复制命令 |
| 清除痕迹 | 勾选项（钥匙串/登录态与最近文件/缓存）→ 逐项结果列表 | Rust purge 按勾选项执行；注明 git 凭证不在管辖范围 |

## 5. 分期状态

- **M1（已完成）**：启动、内容树、打开、契约表单（默认收起）、Markdown 编辑、
  保存/校验、手动预览、新建、草稿。
- **M2（已完成）**：
  - `/api/asset`（拖入/工具条上传，≤2 MB、仅图片、魔数校验、sha256 去重、返回插入片段）；
  - 工具条 + 「插入」菜单 + `/api/resources` + 资源选择弹层；
  - `build.py` 解析 `Attachment.resource`；`check.py` 加不变量；
  - M/U/D 徽标、右键菜单、`/api/delete`、外部改动检测（409）、写入前确认弹层、提取码复制。
- **M3（已完成）**：
  - 登录：`POST /api/session`（Gitee `/user` 校验；钥匙串/内存双存储，失败降级不落文件）、
    `GET /api/whoami`、`DELETE /api/session`（purge 才清钥匙串）、`POST /api/purge`（按勾选项逐项清理）、
    `/api/recent`（只存路径）、`/api/about`；
  - 反代只对 `/api/pr`、`/api/delete`、`/api/rename` 注入 `X-Gitee-Token`；未登录 401；
  - `/api/pr`：`checkout -b → add → commit → push → Gitee PR`，403 走 fork 兜底，
    永不 force / 永不推 master，失败给 `compare_url + commands`；
  - `site.sml: reviewers: [ sal ]`（`REC_BLOG_REVIEWERS` 可覆盖）；
  - UI：`login.html`（记住/仅本次会话、登录中/失败态）、`settings.html`
    （账户与安全/外观/编辑/资源与附件/关于；localStorage 不含令牌；改完即时生效）、
    PR 弹层、未登录置灰（提交 PR/删除/重命名）；
  - Tauri：`--features desktop` 用系统 WebView（tauri 2.12.4 / wry 0.57.0 / tao 0.37.1），
    **已在 Windows 实跑验证**（见 `docs/GUI-HANDOFF.md` §3）。
