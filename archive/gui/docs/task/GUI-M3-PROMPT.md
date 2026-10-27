# 给 hy4 的 M3 提示词（登录 / PR / 设置 / Tauri）

> 基线：`628331c`（M1+M2 完成、正文 Times 字体、英文示例文章）。
> 只做 M3；与并行的 hy3 i18n 任务**分文件**，别互相覆盖。

```text
继续 rec-blog 写作台，做 M3。仓库根目录：C:\Users\sakeen\Desktop\rec-blog
先确认 HEAD 是 628331c 或更新；不要 rebase/force，不要回退 c4600ba 的安全修复。
先读：docs/GUI.md、docs/GUI-FLOWS.md、docs/GUI-IMPLEMENT-PROMPT.md 的 M3 段、
docs/GUI-HANDOFF.md、docs/gui-mock/login.html、settings.html。

# 文件所有权（重要：hy3 正在并行做 i18n）
你只改这些：
  gui/**、engine/gui.py、engine/gui_api.py、tests/gui_api_test.py、
  site/content/site.sml（只加 reviewers）、docs/GUI-IMPLEMENT.md、docs/GUI-HANDOFF.md
不要改这些（hy3 的）：
  site/theme/app.js、site/theme/style.css、engine/build.py、engine/lib/markdown.py、
  site/content/posts/**、site/theme/i18n*
如果确实必须改，先在 docs/GUI-HANDOFF.md 里写清楚并等确认。

# 一、登录 / 钥匙串 / 清除痕迹

1) Rust（gui/src/session.rs）
   - POST /api/session {token, remember}：
     * 先调 Gitee `GET https://gitee.com/api/v5/user?access_token=...` 验证；
     * 成功：返回 {login, name, avatar_url}；
     * remember=true → 写系统钥匙串（Windows Credential Manager / macOS Keychain / libsecret）；
       钥匙串失败 → 明确提示并降级为仅内存，**不得回退到文件**；
     * remember=false → 只放进程内存；
     * token 绝不进日志/URL/配置文件；日志统一 redact()。
   - GET /api/whoami：返回当前登录（未登录 401）。
   - DELETE /api/session：清内存；不删钥匙串（除非请求带 purge=true）。
   - POST /api/purge：逐项清理并返回 [{item, ok, detail}]：
     钥匙串 token、最近文件、预览/构建缓存、日志、（可选）剪贴板。
     界面要注明「git 自身保存的凭证不在本 App 管辖范围」。
2) 反代：
   - 只有 /api/pr、/api/delete、/api/rename 注入 X-Gitee-Token；
   - 其他接口不注入；Python 只读该头，不落盘、不日志。
3) UI（gui/assets/login.html + app.js）
   - 令牌输入、记住/仅本次会话、登录中/失败态；
   - 未登录：确认写入/预览/新建可用；提交 PR、删除、重命名置灰并提示「登录后可用」；
   - 设置页加账户与安全：登录状态、退出登录、清除痕迹（勾选项 + 结果列表）。

# 二、提交 PR（/api/pr）

输入：{paths, branch, message, title, body, reviewers}
- 校验 paths 都在 site/content/**；空列表 → 400；
- 分支：默认 post/<slug>-<yyyyMMddHHMM>；拒绝 master/main、拒绝空格与 ..；
- 执行：git checkout -b <branch> → git add <paths> → git commit -m <message>
  → git push -u origin <branch>；
- **永不 --force、永不直接推 master**；
- 调 Gitee API 建 PR：POST /repos/{owner}/{repo}/pulls
  {title, head: branch, base: "master", body, assignees: reviewers}；
- push 403/401 时走 fork 兜底：
  POST /repos/{owner}/{repo}/forks → 等 fork 就绪 → 加 remote fork → push
  → PR head = "<login>:<branch>"；
- 任一步失败：返回 {ok:false, stage, error, compare_url, commands}，
  **不 force、不改历史、不自动重试**；
- 成功：返回 {ok:true, branch, commit, pr_url, reviewers}。
- UI：PR 弹层（改动文件多选、分支、commit 信息、标题/描述、审核人）；
  成功显示 PR 链接；失败显示 stage + compare 链接 + 可复制命令。

# 三、reviewers / 权限门禁

- site/content/site.sml 加 reviewers: [sal]（可多个）；
  环境变量 REC_BLOG_REVIEWERS 覆盖（逗号分隔）；
- PR 弹层默认带出，可增删；
- M2 遗留：/api/delete、/api/rename 现在只有本地 token。
  M3 起要求登录（X-Gitee-Token 非空），未登录 401；不做更细 RBAC，
  文档里写明「登录=本地管理员，细粒度权限留给平台」。

# 四、设置页（gui/assets/settings.html）

- 账户与安全：登录状态、令牌存放位置（只读）、退出登录、清除痕迹；
- 外观：主题（跟随系统/亮/暗）、顶部动作文字、工具条文字、侧栏显示；
- 编辑：自动保存（默认关）、预览（手动/自动）、图片插入；
- 资源与附件：提取码显示/点击复制/引用方式；
- 关于：版本、引擎 commit、运行方式（Web/Tauri）。
- 设置存 localStorage，**不得存 token**；改完即时生效。

# 五、Tauri（必须实跑）

- [features] desktop = ["dep:tauri"]，gui/src/desktop.rs 用系统 WebView；
- 必须实际运行并贴结果：
    cargo check --features desktop
    cargo build --features desktop
- 成功 → docs/GUI-IMPLEMENT.md 写「Tauri 已在 Windows 验证」；
- 失败 → 贴完整命令、tauri/tao/wry 版本、错误码、关键日志；
  不得跳过、不得删除 desktop 特性。
- 默认特性（无 desktop）必须全绿。

# 六、测试（tests/gui_api_test.py 增补）

- 未登录调 /api/pr → 401，且 git status 不变；
- 未登录调 /api/delete、/api/rename → 401；
- 分支名 master/main/.. → 400；
- PR 失败路径返回 compare_url + commands，不执行 force；
- 钥匙串不可用 → 降级内存（Rust 单测，可用注入的假 keyring）；
- redact()：日志中不出现 token；
- purge 返回逐项结果；token 不在 localStorage/配置文件。
JS 侧：登录页/设置页至少 DOM 冒烟（未登录置灰、登录后启用）。

# 七、验收（全绿）

cargo fmt --check
cargo clippy -- -D warnings
cargo test
python engine/test_contracts.py
python engine/test_render_safety.py
python engine/test_structure.py
python tests/gui_api_test.py
python engine/cli.py build --offline && python engine/cli.py check

人工：
- 登录（记住/仅本次）→ 重启后钥匙串仍登录（或仅本次失效）；
- 未登录时 PR/删除/重命名置灰；登录后可用；
- 改一篇文章 → 提交 PR → 看到 PR 链接与审核人；
- 清除痕迹 → 钥匙串条目消失、缓存/日志清空、token 不再出现；
- Tauri 编译结果已记录。

# 八、边界

- 不做 CI/部署状态面板；不做多用户/RBAC；不做逐行评论。
- 不新增 pip/Node 依赖；不引 CDN。
- 契约 loose 只写头部；新 href/src 走 urls.safe_url / safeUrl。
- 本地提交、不 push、不 force、不碰 master；每期贴验收输出。
```

关键口径：

- **登录=本地管理员**，不做细粒度 RBAC；
- 令牌只进钥匙串或内存，钥匙串失败降级内存，**绝不落文件**；
- PR 失败必须给 `compare_url + commands`，不能偷偷重试或 force。
