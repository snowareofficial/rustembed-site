# 交给 hy4（coding agent）的完整提示词

> 把下面的代码块整段贴给 coding agent。它是自包含的入口；遇到细节以仓库文档为准。

```text
你在 rec-blog 仓库里实现「写作台 GUI」。仓库根目录：C:\Users\sakeen\Desktop\rec-blog。

先读文档，再写代码。文档冲突时，以 docs/GUI-IMPLEMENT-PROMPT.md 为准；
如果实现中发现规格问题，先改那份文档，再改代码，并在提交里说明。

# 一、必读（按顺序）

1. AGENTS.md —— 仓库约束、双 SML 后端、测试纪律
2. docs/GUI.md —— 设计决策（架构、cargo 分发、令牌纪律、资源附件）
3. docs/GUI-FLOWS.md —— 全功能交互逻辑（启动/登录/编辑/预览/PR/错误状态机）
4. docs/GUI-IMPLEMENT-PROMPT.md —— 详细实现任务书（主规格，API 表格在这里）
5. docs/gui-mock/ —— 视觉基准：index.html / login.html / settings.html / attach.html /
   confirm.html / new.html / style.css（亮暗两套，含改动徽标与右键菜单稿）

# 二、目标与交付

在仓库内新增一个「写作台」，分两部分：

A. Rust 启动器（新增 gui/）
   - 根目录 Cargo.toml 加 [workspace] members=["gui"] resolver="2"；
   - crate 名 rec-blog-gui，二进制名 rec-blog；
   - cargo install --git ... rec-blog-gui 可安装；--force 即更新；
   - rec-blog --version 打印 crate 版本 + 引擎 commit；
   - rec-blog update 对引擎目录 git pull --ff-only，并提示重装命令；
   - 内嵌 Web UI（include_dir! 读 gui/assets）；
   - 本地 axum 服务（127.0.0.1 随机端口）；静态资源 + /api/* 反代到 Python 引擎；
   - 启动并守护 python3 engine/gui.py；会话密钥用环境变量 GUI_TOKEN 传（不放 argv）；
   - 钥匙串（keyring）、打开浏览器；--features desktop 时用 Tauri 系统 WebView；
   - 退出时杀掉 Python 子进程。

B. Python API（新增 engine/gui.py + engine/gui_api.py）
   - 只用标准库；复用 engine/lib/{render,markdown,sml,contract,mindmap,summary}.py；
   - 不用 Flask/FastAPI，不新增 pip 依赖（fontTools 已 vendored）；
   - 提供：types/tree/doc(GET,PUT)/validate/preview/new/asset/status/delete/
     resources/pr/ai-summary/session 相关接口（形状见任务书第 4 节）；
   - 路径白名单：realpath 必须落在 site/content/** 或 site/theme/**，否则 403；
   - 保存：UTF-8 无 BOM、LF、末尾换行；保存前跑契约，失败 422 且不写盘。

还要交付：tests/gui_api_test.py、docs/GUI-IMPLEMENT.md（实现说明与与 mock 的差异）、
更新 AGENTS.md（gui/ 与 engine/gui.py 的职责），.gitignore 加 gui/target/。

# 三、已定决策（不要再改）

1. --site 语义：两种形态都吃。
   - <p>/content 存在 → 视为 site 目录；
   - <p>/site/content 存在 → 视为仓库根；
   - 找不到则默认引擎目录 ~/.local/share/rec-blog/repo（不是 site），
     首次运行 git clone --depth 1 https://gitee.com/rustembed/site.git。
   - python3 优先，回退 python。
2. UI 资源放 gui/assets/（Rust 内嵌）；不要放 engine/gui_web。
3. 契约语法：loose 必须写在头部 —— @contract Name loose { ... }；
   不要写契约体首行 loose。engine/lib/sml.py 两种都兼容，但 VS Code 扩展只认头部。
4. reviewers：M3 在 site/content/site.sml 加 reviewers: [sal]（可多个），
   并支持环境变量 REC_BLOG_REVIEWERS 覆盖；PR 弹层可增删。
5. Attachment.resource 解析归 M2：build.py 按 id 查 resources，填 url/title/code；
   找不到报错；同步 check.py 不变量 + 构建/渲染测试。
6. 按钮默认：顶部动作（确认写入/预览/提交 PR）显示文字；编辑器工具条默认只图标。
   设置里两个独立开关（顶部动作文字 / 工具条文字）。
7. 图片不做独立槽位排：拖进正文或工具条「图片」插入，自动存 assets/。
8. 块面板不单独常驻：全部收进「插入」菜单（段落/标题/代码块/附件/分割线/
   面板/步骤/提示/图集/词条）。
9. 登录用 Gitee 个人令牌（不做 OAuth），但令牌严禁明文：
   只进系统钥匙串或进程内存；钥匙串失败则仅本次会话；不写文件/日志/URL。
10. 不做 CI/部署状态面板；不做多用户；不做逐行 diff/评论（跳 Gitee）。

# 四、架构与启动流程

cargo install → rec-blog
  → 找引擎（--site / REC_BLOG_SITE / ~/.local/share/rec-blog/repo）
  → 检查 python3 >= 3.11
  → spawn: python3 engine/gui.py --port 0（GUI_TOKEN 走 env）
  → 读 stdout 的 GUI_PORT=<n> 握手
  → axum 起在 127.0.0.1:<随机>，/api/* 反代到 Python，注入 X-GUI-Token
  → 有 desktop feature 开 Tauri 窗口，否则开浏览器
  → 退出时 kill Python 子进程

Rust 侧只做：参数、引擎发现、进程守护、静态托管、反代、钥匙串、打开窗口。
Rust 不写 UI、不实现渲染/契约/Markdown。

# 五、安全红线（违反即返工）

- 令牌严禁明文：不进配置文件、不进日志（日志脱敏 ***）、不进 URL、不进剪贴板历史；
  只允许系统钥匙串或内存；钥匙串不可用不得回退到文件。
- 永不 git push --force、永不直接推 master；PR 一律走分支。
- 路径白名单：只允许 site/content/** 与 site/theme/**；拒绝 ../ 与符号链接逃逸。
- 保存必须 UTF-8 无 BOM；内容文件带 BOM 会让 CI 的 builtin SML 解析失败。
- 不引入 Node 构建链、不引第三方 CDN、不加 pip 依赖。

# 六、分期（每期都要能跑、能验收）

M1：启动 → 内容树 → 打开 → 契约表单（默认收起）→ Markdown 编辑 → 保存/校验
    → 手动预览 → 新建 → 草稿
  1) 先跑一遍全站 contract.validate 探测严格契约下是否有 E-CONTRACT-004；有就报告，
     不要擅自改契约。
  2) Rust：workspace + gui crate + args/engine/assets/server；握手；静态 + 反代；
     --version / update / --no-open；退出杀子进程。
  3) Python：types/tree/doc/validate/preview/new/status + PUT doc；
     路径白名单；无 BOM；保存前校验。
  4) UI：三栏（左树/中编辑/右纯预览）、顶栏（品牌·类型·契约绿点+倒三角·分支 chip·
     确认写入/预览/提交 PR/设置）、元数据 details 默认收起、契约字段生成的表单、
     Markdown textarea、手动预览（Ctrl+P，右栏 待生成/生成中/已生成）、
     新建弹层（类型卡片 + 路径预览 + slug 校验 + 草稿）、状态栏（路径/字数/已保存/改动 N）。
  5) tests/gui_api_test.py 前 5 条：BOM→无 BOM；../../etc/passwd→403；
     缺必填→422 且不写盘；预览与 build 片段一致；日志无 token。

M2：编辑器全覆盖 + 资源附件 + 改动标记
  1) /api/asset（≤2MB、仅图片、文件名清洗、同名去重、返回 markdown 片段）；拖入正文。
  2) 工具条（粗体/斜体/行内代码/链接/图片/视频/公式/列表/表格/引用）+
     「插入」菜单（标题、附件、分割线、面板、步骤、提示、图集、词条）：
     .md 写 :::xxx，.sml 写对应裸块。
  3) /api/resources?q= + 资源选择弹层（搜索/类型/文件夹筛选/提取码 chip 复制/
     引用 id 或复制独立附件）。
  4) engine：build.py 解析 Attachment.resource；app.js 附件卡显示「提取码 · 复制」；
     check.py 加不变量。
  5) /api/status 驱动 M/U/D 徽标；右键菜单（打开/重命名/转草稿/复制链接/删除）；
     /api/delete（git rm，需登录）；外部改动检测（hash 比对 → 重载/覆盖/取消）；
     写入前确认弹层（对齐 confirm.html）。
  6) 测试：资源引用解析、删除需登录。

M3：登录 / 钥匙串 / PR / 设置 / Tauri
  1) Rust：POST /api/session（Gitee GET /user 验证 → 钥匙串，失败降级内存）、
     GET /api/whoami、DELETE /api/session、POST /api/purge（逐项返回清了什么）；
     反代 /api/pr 时注入 X-Gitee-Token。
  2) Python：/api/pr（checkout -b → add → commit → push → Gitee PR；
     403 → fork 兜底：POST /repos/{owner}/{repo}/forks，推自己的 fork，
     head=<user>:<branch>；永不 force、永不推 master；失败返回 compare_url + 命令，
     不执行 git）；/api/ai-summary（可选，失败 4xx）。
  3) UI：login.html（记住/仅本次会话）、settings.html（外观/编辑/资源/关于 +
     清除痕迹，设置存 localStorage，不含 token）、PR 弹层（改动列表勾选/分支名/
     commit 信息/审核人/标题/描述）。
  4) 测试：无 token 调 /api/pr → 明确错误且不执行 git（断言 git status 不变）；
     Rust + Python 日志脱敏单测（token 不出现）。
  5) Tauri：--features desktop 用系统 WebView（Windows WebView2 / macOS WKWebView）。
     本机已具备 rustc MSVC、VS BuildTools、WebView2；M3 必须实际运行：
       cargo check --features desktop
       cargo build --features desktop
     成功 → docs/GUI-IMPLEMENT.md 写「Tauri 已在 Windows 验证」；
     失败 → 贴完整命令、tauri/tao/wry 版本、错误码与关键日志，记录在文档；
     不得静默跳过、不得删除 desktop 特性。若本机有已编译过的 Tauri 工程配置，
     优先复用 tauri.conf.json / build.rs / icons / capabilities。

# 七、UI 规格（以 docs/gui-mock 为准）

- 三栏：左树 15rem / 中编辑自适应 / 右纯预览 24rem；左右可收起；顶栏 3.5rem、底栏 2rem。
- 视觉令牌与站点一致（米白 #faf8f5、墨色 #1f1c19、赭红 #a8471f；暗色同站）。
- 顶栏：品牌、类型选择、契约绿点+倒三角（明细弹层）、分支 chip、
  右侧动作（确认写入/预览/提交 PR/设置；默认显示文字）。
- 标题行：标题 + 路径；右侧审核人 chip、→ master chip。
- 元数据：默认收起成一条摘要，点开展开契约表单；标签 chips；map/series 可选。
- 编辑器：工具条在编辑器内部（默认只图标）；插入菜单覆盖结构化块；
  图片拖入自动存 assets；公式插 $...$/$$...$$ 模板；Ctrl+B/I/K/S/P/Enter。
- 预览：手动作业；右栏「待生成/生成中/已生成·时间/失败+重试」；不自动刷新。
- 左树：草稿单独分组；M/U/D 徽标；右键菜单；键盘 ↑↓/Enter/Delete/Ctrl+F。
- 登录页：令牌 + 记住（钥匙串）/ 仅本次会话 + 清除痕迹入口。
- 设置页：账户与安全 / 外观 / 编辑 / 资源与附件 / 关于；两个按钮文字开关。
- 资源选择：搜索、类型/文件夹筛选、提取码「复制」、引用 id 或复制独立附件。
- 新建：类型卡片 → 标题/slug/作者/标签/草稿 → 路径预览 → 创建并打开。

# 八、验收（必须全绿，每期贴完整输出）

cargo fmt --check
cargo clippy -- -D warnings
cargo test
python engine/test_contracts.py
python engine/test_render_safety.py
python engine/test_structure.py
python tests/gui_api_test.py
python engine/cli.py build --offline && python engine/cli.py check

人工验收：
- cargo install --path gui 后 rec-blog 能起、能打开 UI；
- 新建 → 写 → 预览 → 保存 → build 通过；
- 令牌不出现在任何文件/日志；
- 页面与 docs/gui-mock 一致或差异有说明；
- M3 的 Tauri 命令有结果（成功或完整失败记录）。

# 九、工作方式

1. 先输出实现计划（文件清单 + 分期 + 风险），等我确认再写代码；
2. 每期结束跑上面验收命令，贴结果；任何一条不绿就停在该期修；
3. 提交粒度：每期多个小 commit（feat(gui)/feat(engine)/test(gui)/docs(gui)），
   不要一个 giant commit；
4. 只在本地提交，不 push、不 force、不碰 master；
5. 发现规格冲突：先改 docs/GUI-IMPLEMENT-PROMPT.md，再改代码，提交里说明。

# 十、非目标

- 不做 CI/部署状态面板；
- 不做多用户/数据库/在线协作；
- 不做逐行 diff/评论（跳 Gitee）；
- 不做自动预览、自动提交；
- 不把引擎重写到 Rust；不引入 Node 构建链或第三方 CDN。
```
