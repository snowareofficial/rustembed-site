# 给 hy4 的 M2 提示词

> 基线：M1 已完成（HEAD `eba4567`，含 `c4600ba` 的 URL 白名单）。
> 只做 M2；M3（登录 / PR / 设置 / Tauri）不要提前。

```text
继续 rec-blog 写作台，做 M2。仓库根目录：C:\Users\sakeen\Desktop\rec-blog
先确认 HEAD 是 eba4567 或更新；不要 rebase/force，不要回退 c4600ba 的安全修复。
先读：docs/GUI.md、docs/GUI-FLOWS.md、docs/GUI-IMPLEMENT-PROMPT.md 的 M2 段、
docs/GUI-IMPLEMENT.md、docs/gui-mock/（index.html、attach.html、confirm.html）。

# 一、M2 范围（只做这些）

1) 图片上传 / 拖入
   - 新增 POST /api/asset，JSON：{name, data_base64}
   - 限制：解码后 ≤ 2MB；仅 png/jpg/jpeg/webp/gif/svg；按魔数或后缀校验；
     文件名清洗（slug），同名用 sha256 去重；保存到当前文档同目录 assets/；
     返回 {path,width,height,markdown}
   - 前端：拖入编辑器 / 工具条「图片」→ 上传 → 在光标处插入 Markdown；
     失败 toast，不插入半截语法。
   - 安全：返回的 path 只用于本站相对路径；不得拼 javascript:/data:（见 c4600ba）。

2) 工具条 + 插入菜单（覆盖原块面板）
   - 工具条（默认只图标，title 提示）：粗体、斜体、行内代码、链接、图片、视频、
     公式、无序列表、表格、引用；快捷键 Ctrl+B/I/K。
   - 「插入」菜单：标题、代码块、附件、分割线、面板、步骤、提示（note/tip/warn）、
     图集、词条、when。
   - 语法按当前引擎：
     * .md：:::note / :::tip / :::warn / :::panel / :::steps / :::shot / :::gallery /
       :::term / :::when（以 engine/lib/markdown.py 实际支持为准）；
     * .sml：写对应的裸块（panel/steps/shot/gallery/term/when），不要写 :::。
   - 插入后光标落在内容区；不破坏选区/撤销（尽量用 document.execCommand 或手动选区）。
   - 工具条文字开关沿用 M1 设置；M2 默认只图标。

3) 资源库与附件
   - GET /api/resources?q=&kind=&folder=：返回 id/title/kind/folder/url/code/tags。
   - 资源选择弹层对齐 docs/gui-mock/attach.html：
     搜索、类型/文件夹筛选、提取码 chip「复制」、引用 id / 复制独立附件。
   - 附件写法：
     * 默认引用：{name, kind: "link", resource: "<id>"}（kind 必填，契约要求）
     * 复制独立：{name, kind:"link", url, code}
   - 前端附件卡：显示渠道与「提取码 xxxx · 复制」，点击复制 + toast；
     资源列表同样显示提取码复制。
   - 安全：资源 url 必须过 urls.safe_url；code 只做文本/长度校验，不当 URL 拼。

4) engine 改动（必须）
   - build.py：构造 attachments 时，若 resource 存在，按 id 在 resources 中查，
     用其 url/title/code 填充；找不到 → rep.err（构建失败），不要静默。
   - check.py：加不变量——带 resource 的附件必须能解析；manifest 里不得出现
     javascript:/data: 的 href/src 目标。
   - site/theme/app.js：附件卡与资源列表显示提取码复制；新拼 href/src 必须走 safeUrl。

5) M/U/D 徽标 + 右键菜单
   - 树项显示 git status 的 M/U/D（已有 /api/status）；保存/新建/删除/资源写入后刷新。
   - 右键菜单：打开、重命名、转草稿、复制站内链接、删除。
     * 重命名：只改文件/目录 slug，git mv，确认框；不自动改站内引用（文档里说明）。
     * 删除：确认框要求输入 slug；POST /api/delete {path, confirm}；git rm。
       M2 先不做登录鉴权（M3 才登录），但本地 API 仍需 GUI_TOKEN；
       文档里明确「M3 会加登录/管理员门禁」。
     * 转草稿：写 draft: true 并保存。
     * 复制链接：复制 #/post/<slug> 到剪贴板。

6) 外部改动检测 + 写入前确认
   - /api/doc 返回 mtime + 内容 hash；PUT 时带 base_hash（或 base_mtime）。
   - 磁盘被外部改过 → 409，不写；前端弹「重新加载 / 覆盖（二次确认）/ 取消」。
   - 写入前确认弹层对齐 docs/gui-mock/confirm.html：只列真实来源项
     （表单 / 解析 / 附件），不要出现“自动”这种凭空来源。
   - 至少用于：资源→附件插入、批量字段变更；单图上传可即时插入。

7) 顺手修 M1 的一个小问题
   - 未打开文档时状态栏 `未保存` → 改为 `未打开`；openDoc 成功后显示 `已保存`。
     （gui/assets/index.html 初始文案 + app.js 状态切换）

# 二、边界（不要做）

- 不做登录 / 钥匙串 / PR / 设置页 / Tauri（M3）。
- 不做 CI/部署状态面板、多用户、逐行 diff。
- 不改 site/content 正文来测试；测试用临时目录或测试后清理。
- 不新增 pip / Node 依赖；不引 CDN。
- 契约 loose 只写头部；不要写体首行 loose。
- 任何新增 href/src 出口必须过 urls.safe_url / safeUrl。

# 三、测试（必须新增）

tests/gui_api_test.py 增补：
- /api/asset：>2MB → 413；非图片 → 415；文件名清洗；同内容去重；
- /api/resources：q/kind/folder 过滤；code 原样返回；
- build：带 resource 的附件解析出 url/code；resource 不存在 → 构建失败；
- /api/delete：confirm 不匹配 → 400；confirm 匹配 → git rm（临时仓库/临时站点）；
- 外部改动：改磁盘后 PUT → 409 且不覆盖；
- 安全：resource url 为 javascript: → 被拒或清空，manifest 不得出现。
JS 侧至少做一次 DOM 冒烟（现有 tests/browser-check.js 或新增）：
- 附件卡有「提取码」按钮；点击后 toast；资源弹层能筛选。

# 四、验收（全绿）

cargo fmt --check
cargo clippy -- -D warnings
cargo test
python engine/test_contracts.py
python engine/test_render_safety.py
python engine/test_structure.py
python tests/gui_api_test.py
python engine/cli.py build --offline && python engine/cli.py check

人工：
- 拖一张图进正文 → 插入 Markdown → 保存 → build 通过；
- 插入菜单每个块都能生成正确语法（.md 与 .sml 各验一次）；
- 资源选择 → 引用 id 插入 → 构建后附件有 url/提取码；改资源后重新构建，附件跟着变；
- 点提取码复制有 toast；
- 右键转草稿 / 删除（confirm）/ 重命名；M/U/D 徽标刷新；
- 外部改文件后保存 → 409 → 重载/覆盖流程。

# 五、提交与文档

- 每块一个 commit：feat(engine): asset/resources 接口；feat(engine): resource 附件解析；
  feat(gui): 工具条+插入菜单；feat(gui): 资源弹层+提取码；feat(gui): 右键菜单/外部改动；
  test(gui): M2 回归；docs(gui): M2 实现说明。
- 更新 docs/GUI-IMPLEMENT.md：M2 接口、与 mock 的差异、M3 待办。
- 本地提交，不 push、不 force、不碰 master；每期贴验收输出。
```

补充两条人工验收口径：

- `Attachment.kind` 是必填枚举，资源插入时统一用 `link`（资源不是图片）；
- `resource` 解析发生在构建期，附件里不要同时写死 `url` 和 `resource`；同时存在时以 `resource` 为准并在文档里写明。
