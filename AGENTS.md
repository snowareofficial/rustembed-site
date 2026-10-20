# AGENTS.md — 仓库索引（给 AI  Agent 的入口）

> 本文件是**仓库级索引**：另一个 AI 接手本仓库时先读这里，再按指针读细节。
> 站点内容级的 AI 可读索引是构建产物 `dist/llms.txt` / `dist/llms-full.txt`，不要混淆。
> 人类向文档：`README.md`（上手）、`docs/README.md`（文档索引）、`engine/README.md`（工具体系）、`docs/ARCHITECTURE.md`（架构）。

## 1. 这个仓库是什么

QQ 群「Rust嵌入式探讨」的共建博客。内容 = Markdown（默认）或 SML 文件，
`engine/` 在**构建期**做契约校验 + 预渲染，产出纯静态站点到 `dist/`（hash 路由，零后端、零运行时框架）。
engine 与站点内容完全解耦：换 `site/` 目录即可复用到别的站点（`--site` 或 `REC_BLOG_SITE`）。

## 2. 目录索引

```
rec-blog/
├─ gui/                    写作台（Rust 启动器 + 内嵌 Web UI；cargo install rec-blog-gui）
│  ├─ src/                 args / engine / assets / server / session / main
│  └─ assets/              index / login / settings + app.js + style.css（由 docs/gui-mock 改造）
├─ engine/                 可复用工具体系（不认识任何具体内容，只认目录约定）
│  ├─ config.py            站点定位：SITE/CONTENT/THEME/OUT/CACHE 路径约定；--site 参数
│  ├─ build.py             构建主流程：校验 → manifest → 预渲染 → 索引/RSS/sitemap/llms/字体子集
│  ├─ check.py             产物自检不变量（CI 用）；只读 dist/、不比对源码时间戳，dist/ 缺失直接退出
│  ├─ cli.py               命令行入口：new / list / contracts / build / check / test / preview
│  ├─ test_contracts.py    契约引擎自测（错误码语义，对齐 SML 上游 sml-codes）
│  ├─ test_sml_include.py  include / 命名空间 / 契约桥接回归（[B][D] 组需 native，缺则 SKIP）
│  ├─ test_render_safety.py 渲染安全回归（契约页转义 / 内联角色 / 嵌套列表 / --out 守卫 /
│  │                        URL 白名单 / safe_url 单元 / assets 改写 / 双后端 SML 错误类型）
│  ├─ test_structure.py     产物结构断言（纯静态，不需要浏览器）
│  ├─ preview.py           本地静态服务（后台运行 + 日志，默认 127.0.0.1:8080）
│  ├─ gui.py               写作台 API 入口（--port/--site；GUI_TOKEN；stdout 打印 GUI_PORT=）
│  ├─ gui_api.py           写作台 /api/*：树 / 文档读写 / 校验 / 预览 / 新建 / 资源 / PR
│  ├─ ai_summarize.py      AI 摘要（OpenAI 兼容；写 summaries/<slug>.json）
│  ├─ verify_parity.py     内置 / 原生 SML 后端一致性校验
│  ├─ fonts_import.py      从字体包挑权重到 site/fonts/src/（不整包解压）
│  ├─ git_ready.py         入库前检查 / 本地提交（不 push；大文件与忽略规则检查）
│  ├─ native/sml.dll       SML 原生载体（加速 + include / 命名空间展开，仅文件入口使用）。
│  │                       engine/native/ 已 gitignore：干净克隆没有它 —— 不含 include 的内容照常
│  │                       构建，含 include 的内容明确报错（不静默降级，见 §14）；可用 SML_LIB /
│  │                       REC_BLOG_SML_LIB 环境变量指定库路径
│  ├─ vendor/              vendored fontTools / latex2mathml（构建期，不 pip）
│  └─ lib/
│     ├─ sml.py            SML 子集解析器（片段 &、契约 @contract/@is；builtin/native 双后端，可改）
│     ├─ _swsml.py         SML 原生绑定：vendored from swsml 0.6.4（MulanPSL-2.0）。别就地
│     │                    「改进」上游行为，升级 vendor 时以上游为准
│     ├─ markdown.py       Markdown 子集（front matter、:::note 提示块）
│     ├─ render.py         SML 块 → HTML（内联角色、B 站视频白名单）
│     ├─ contract.py       契约校验（E-CONTRACT-001–006、008；007 在码表里不存在）
│     ├─ mindmap.py        导图 SVG 生成（整齐树布局）
│     ├─ mathml.py         LaTeX → MathML（构建期；失败回退 math-raw）
│     ├─ summary.py        摘要：优先 summaries/*.json，否则抽取式
│     ├─ urls.py           URL 协议白名单（http/https/mailto/tel、#、相对路径）
│     └─ repo_meta.py      仓库元数据抓取（GitHub/Gitee/Codeberg/Gitea）+ 缓存
├─ site/                   站点本身（换站点只换这个目录）
│  ├─ content/
│  │  ├─ site.sml          站点配置：title/tagline/url/nav/contracts 默认映射/group 群信息
│  │  ├─ posts/<年>/<短名>/index.(md|sml) + assets/    文章
│  │  ├─ pages/*.(md|sml)  站文档（group + order 决定文档树）
│  │  ├─ topics/*.(md|sml) 主题词条（同标签文章自动归入）
│  │  ├─ members/<id>.sml  成员档案（自愿制；同目录 <id>.jpg 自动作头像）
│  │  ├─ services/<id>.sml 能力与合作黄页（纯展示；owner 必须是成员，contact 只引用其已公开 links）
│  │  ├─ projects/<id>.sml 项目（构建期抓仓库元数据）
│  │  ├─ resources/<id>.sml 资源条目
│  │  ├─ weekly/<期>.sml   周报 / 月刊
│  │  ├─ quotes/<成员 id>/quotes.sml  首页「一言」（每人 ≤3 条、全站 ≤60 条）
│  │  └─ contracts/*.sml   内容契约（字段即文档；自动生成契约文档页）
│  ├─ theme/               前端壳：index.html + app.js（路由/视图）+ style.css
│  │  ├─ vendor/prism/     Prism 1.29.0（MIT）本地副本 + 本站自写的 SML 语法与配色（禁 CDN）
│  ├─ fonts/               自托管 MiSans + XITS Math（+ STIX 兜底）：src/ 与 subset/ 均 gitignore；
│  │                       加密包 misans-fonts.tar.gz.enc 入库（含三者），CI 用 FONT_PASSWORD 解密
│  │                       （deploy/fonts-crypt.sh）；许可随产物发布到 dist/fonts/
│  └─ meta/repos.json      仓库元数据缓存（入库）
├─ tests/                  smoke.js / browser-check.js / series_tag_test.js / gui_dom_test.js
│                          / gui_api_test.py / dom-stub.js
├─ deploy/                 自托管：entrypoint / build / rebuild / gitee-webhook / fonts-crypt
├─ docs/                   索引 docs/README.md；参与者 ROLES/CONTRIBUTING/EDIT-SITE-DATA/
│                          REVIEW/OPS；维护 ARCHITECTURE/WORKFLOW/FONTS/GOVERNANCE/
│                          REPO-LAYOUT/NATIVE/PLAN-SML-NATIVE；GUI.md/GUI-FLOWS/GUI-IMPLEMENT/
│                          gui-mock；archive/ 放已完成的任务书与交接
├─ Cargo.toml / Cargo.lock  Rust workspace（members=["gui"]）
├─ Dockerfile / .dockerignore
├─ dist/                   构建产物（gitignore；固定输出到 <repo>/dist）
├─ LICENSE / LICENSE-CONTENT / CONTRIBUTING.md
├─ .github/                CI（build.yml 门禁 + publish-pages.yml 发布 + sync-from-gitee.yml）+ PR 模板
└─ .gitee/                 Gitee（权威源，PR/Issue 落地点）的 PR/Issue 模板
```

## 3. 数据流（改代码前先理解这条链）

```
site/content/**/*.(md|sml)
  → engine/build.py: load2() 解析 → apply_contract() 校验（文件里 @is 优先，否则按 site.sml
    的 contracts{} 默认映射；两者都没有时退回 build.py 顶部 REQ 硬编码必填表）
  → render.render()/md.render() 预渲染 HTML 片段 → dist/{p,topics,services,w,pages}/<id>.html
  → dist/manifest.json（站前端唯一数据源；_ 前缀字段被过滤，不进 manifest）
  → site/theme/app.js: fetch manifest.json → hash 路由（#/library、#/post/<slug>、#/service/<id>…）
  → 视图用 DOM API（el/link）拼卡片，正文走 fragment() 取预渲染 HTML 赋 innerHTML
```

要点：
- **构建期对全部用户内容做 HTML 转义**（render/markdown 出口统一 esc），前端仍不信任任何投稿文本。
- **第三方前端库只许本地 vendor**：语法高亮用 `site/theme/vendor/prism/`（Prism 1.29.0 MIT +
  本站自写的 SML 语法与配色），`site/theme/index.html` 加载前先设 `Prism.manual = true`，
  每次路由渲染完由 `app.js` 调 `Prism.highlightAllUnder(view)`。**不许改成 CDN**：
  本站运行时零外部请求，加载失败必须退回纯文本（`check.py` 与两个测试脚本都盯着这条）。
- **成员 links 的两个键不能重名**：一人两个 Gitee 要写 `gitee` + `gitee_org`
  （同名 `gitee` 会被对象覆盖，构建不报错但页面只显示一条）。加键要同步三处：
  `contracts/blog.sml` 的 `MemberLinks`、`app.js` 的 `CONTACT_LABEL`、`docs/EDIT-SITE-DATA.md`。
- **URL 协议白名单已落地**（`engine/lib/urls.py`）：只放行 http / https / mailto / tel、
  页内 `#` 锚点与相对路径；`javascript:` / `data:` / `vbscript:` / `file:` / 协议相对 `//host` 一律拒绝。
  已覆盖五处出口：`{link:}`、SML `a`/`img`（含 shot/gallery）、Markdown 链接与图片；
  构建期还会清洗 projects（repo/homepage）、members.links、resources.url、pages.group_link、
  site.avatar/repo_url 与 group.join_url。新增任何拼 href/src 的代码必须调用 `urls.safe_url()`；
  回归在 `engine/test_render_safety.py` 第 [9] 组（含 `//evil`、控制字符、大小写混淆）。
- manifest 是前端唯一数据源；新增内容类型 = 新增 manifest 键 + app.js 路由/视图。
- 站点默认许可 CC BY-NC-SA 4.0（`site.sml: default_license`），llms.txt/页脚都会引用。
- `search-index.json` 的正文在构建期就被截断：每篇取 `p["_text"][:4000]`（`build.py:1034`），
  超长文章的后半部分**搜不到**（当前最长文章 959 字，尚未触发）。

## 4. 常用命令

```bash
python engine/cli.py new "标题" --tags rust,embedded --author sal --slug my-post  # 文章骨架
#   default 陷阱：--author 默认 sal、--tags 默认 rust，不显式写会把文章署名成 Sal；
#   另有 --sml（生成 SML 版）、--topic（建主题词条，落 content/topics/）、--series
python engine/cli.py contracts                          # 终端看契约字段表
python engine/cli.py build                              # 构建（含契约校验）
python engine/cli.py build --offline                    # 不联网，只用 meta/repos.json 缓存
# build.py 直跑的开关还有：--out（产物目录，受 guard_out 守卫）、--base-url、--warn-only、--contract-loose；
# cli.py build 只暴露 --offline / --contract-loose / --site。警告：--warn-only 会把契约/附件错误
# 降级为告警（CI 明确不加，见 .github/workflows/build.yml）；--contract-loose 放开 E-CONTRACT-004
# （未声明字段）——两者都别在提交前用。
python engine/git_ready.py                              # 入库前检查（大文件/忽略规则）；--commit 可本地提交（不 push）
python engine/cli.py test                               # test_contracts.py
python engine/cli.py check                              # check.py（跑在 build 之后）
python engine/cli.py preview                            # 构建 + 本地预览

# 写作台（gui/ + engine/gui.py）：Rust 只做外壳，引擎仍是 Python
cargo fmt --check && cargo clippy -- -D warnings && cargo test   # Rust 门禁（workspace 根）
python tests/gui_api_test.py                            # 写作台 API 回归（起真实服务 + 临时站点）
cargo install --path gui                                # 安装二进制 rec-blog；--force 即更新
rec-blog --site . --no-open --port 8788                 # 起写作台（--site 吃仓库根或站点目录）
rec-blog --version                                      # crate 版本 + 引擎 commit
rec-blog update                                         # 引擎 git pull --ff-only，二进制要自己重装
```

提交前六连（与 `.github/workflows/build.yml` 的门禁一致）：
`python engine/test_contracts.py` → `python engine/test_sml_include.py` →
`python engine/test_render_safety.py` → `python engine/build.py` →
`python engine/check.py` → `python engine/test_structure.py`，全绿才算完成。
注意：CI 跑的是**联网** build（元数据抓取失败不中断，回退 `meta/repos.json` 缓存）；
本地求快可加 `--offline`，但抓取降级路径只在联网构建里能复现。
另：`cli.py test` 只跑 `test_contracts.py`；渲染安全回归要直接跑 `engine/test_render_safety.py`。

前端三连（改了 `site/theme/**` 就一起跑）：
`node tests/series_tag_test.js`（标签页系列合并 / 成员页列表 / 页脚声明）→
`node tests/reading_controls_test.js`（最近条数 / 一言 / 代码折叠 / 高亮 / 成员链接标签）→
`node tests/gui_dom_test.js` → `node tests/smoke.js`。
样式相关的（滚动区、页脚显隐、375px 溢出）再跑 `node tests/browser-check.js`：
它要先 `python engine/cli.py preview` 起服务，且**自己挑一个能 bind 的调试端口** ——
Windows 默认保留 9211–9310，以前写死 `9222+pid%200` 会稳定落进去，CDP 起不来干等 20s 超时。

## 5. 加一个内容类型（官方扩展步骤，来自 engine/README.md）

1. `engine/build.py` 仿 `build_topics()` 写 `build_xxx()`；
2. 在 `main()` 里调用，写产物文件与 manifest 新键；
3. `lib/contract.py` 或 `site/content/contracts/blog.sml` 补契约字段；
4. `site/content/site.sml` 的 `contracts{}` 加默认映射、`nav` 加一项；
5. `site/theme/app.js` 加路由与视图（复用现有 `.card`/`.badge`/`.tags`/`.meta`/`.admonition`，不造新设计语言）；
6. `engine/check.py` 加该类型的不变量；
7. 需要脚手架时在 `cli.py` 的 `new` 子命令加模板。

**契约语法（与 VS Code 扩展对齐）**：`loose` 写在头部 —— `@contract Name loose { ... }`，
不要写成契约体里的第一行。Python 内置解析器两种都兼容（`lib/sml.py` 会读头部参数），
但扩展/上游语法只认头部；体首行写法会让 `.sml` 在编辑器里报
`sml: 契约字段期望名称, 得 :`。改动契约后可用扩展的 `diagnose()` 扫描一遍：
`node` 加载 `~/.vscode/extensions/snoware.sml-lang-*/src/sml-parse.mjs` 即可。

已按此流程落地的最新样例：`services`（能力与合作黄页，2026-10-16），
参考实现 = `build_services()` + `@contract Service` + `viewServices()/viewService()`。

## 6. 硬约束（踩线即 bug，不是建议）

- `engine/lib/sml.py` 是 builtin/native 双后端，但**两者目前并不等价**（已实测，别以为有保障）：
  native 支持顶层 `@is` 指令，builtin（没有 `engine/native/` 原生库时的默认后端，CI 即此路径）会把
  `@is P` 解析成裸块头并在下一行抛「期望一个值」；`@contract` 两后端都支持（均产出 11 个契约）；
  `__type` 块标记两后端由不同路径产生，别依赖它存在与否。`set_backend()` 可强制切换，
  **当前没有自动差分测试**，改完必须手动跑两种后端比对；
  `engine/lib/_swsml.py` 是 swsml 0.6.4 的 vendor 副本，别就地「改进」，升级以上游为准；
  `build.py` 的 `guard_out()`、`.github/` 下任何文件勿改。
- **include / 命名空间只在「文件入口」生效**：`load_doc(path, root=None)` 与
  `parse_doc_at(text, path, root=None)`（`build.load2()`、写作台校验与预览都走它们）。
  文本入口 `parse_doc(text, path)` 一律**不展开** include，撞上就报错，绝不静默当字段。
- **include 的允许根 = `site/content`**（`config.CONTENT`）：跨兄弟目录可以，
  逃出内容目录（绝对路径 / `..` / symlink 指外）一律 `E-INCLUDE-003`。
  native 自己的沙箱更紧（基准 = 包含者目录），靠**临时扁平化预处理**绕开，
  不放宽 native（详见 `docs/ARCHITECTURE.md` §15）。
- **含 include 的内容必须用 native 构建**：native 缺失时构建直接失败并报 `E-FEATURE-001`
  （附安装办法）。不含 include 的内容无论有没有 native，产物都一致。
- **契约校验只在一处**：`lib/contract.py`。native 侧的类型系统不等价（`url`/`date`/`image`
  会被当成契约名）、命名空间隔离也没实现，别把 `@contract` / `@is` 交给它（细节见 §14）。
- **桥接只沿真实 include 图走**：禁止扫描工作区所有 `@contract` 来"补全"契约表 —— 那会
  绕过命名空间隔离。
- **临时树只在系统 temp，用完必删**：`site/content` 下不得出现任何副本；
  测试有「源目录无残留 / 系统临时目录无残留」两条断言看着。
- 黄页（services）性质：纯展示，**不参与交易、不担保、不抽成、不经手资金、不介入纠纷**；
  contact 只能引用成员档案 `links` 里本人已公开的字段，不得新收集个人信息；不设计支付/订单/撮合/站内私信/账号体系。
- `--out` 只会清空目标目录：`guard_out()` 拒绝仓库根/站点目录**及其上级**、仓库内非 dist 位置；放行仓库外目录与 `dist/` 子树。
- 契约错误码语义由 `test_contracts.py` 钉住，改 `lib/contract.py` 必须同步用例。
- 已知缺陷（未修）：`lib/sml.py` 内置解析器报错行号偏 1 —— `entry()` 在 `p.skip()` **之后**才取 `head`，
  所以单行文件的「多余的值」会报 `line=2`。投稿者按行号定位会找错一行，修时顺手加一条用例。
- 解析器内部字段（`__is` / `__md_body` / `__type`；注意 `__type` 在每个 SML 块上，不只是文件顶部）以 `_` 前缀统一被挡在 manifest 外（check.py 有断言）。
- **写作台红线**（`gui/` + `engine/gui*.py`；实现说明见 `docs/GUI-IMPLEMENT.md`）：
  - Rust 只做外壳：参数、引擎发现、进程守护、内嵌 UI 托管、`/api/*` 反代、钥匙串、打开窗口；
    **不写 UI、不重写引擎**（解析/渲染/契约/构建一律走 `engine/`）。UI 是 `gui/assets/` 的
    HTML/CSS/JS（vanilla，零构建、不引 Node、不引 CDN，视觉基准 `docs/gui-mock/`）。
  - 令牌只进系统钥匙串或进程内存：不写配置文件、不进日志（两侧都脱敏成 `***`）、
    不进 URL、不进 argv（`GUI_TOKEN` 走环境变量）。钥匙串不可用只能降级为「仅本次会话」，不得回退到文件。
  - 路径白名单：`realpath` 必须落在 `site/content/**` 或 `site/theme/**`，否则 **403**。
  - 保存一律 UTF-8 **无 BOM**、LF、末尾换行，且保存前跑契约，**422 不写盘**。
  - 永不 `git push --force`、永不直接推 master；PR 一律走分支（fork 兜底也要走分支）。
  - 没实现的接口返回 501 + 说明，不假装成功。

### 6.1 契约与编辑器（VS Code 扩展）的分工（2026-10-16 实测）

- **`@contract` 要用**：它是唯一"两边都认"的东西 —— 构建侧由 `lib/sml.py:_parse_contract_body` 解析
  （字段类型 / `optional` / `enum` / `min` / `max` / `default` / `loose`），编辑器侧由
  `snoware.sml-lang` 扩展（`~/.vscode/extensions/snoware.sml-lang-0.4.3`，随上游 `sml` 仓走）读取，
  用于**悬浮契约名看默认值展开、字段补全、以及编辑器内契约语义校验**。改契约 = 同时改校验、错误提示、文档页。
- **`@is` 一般别用**：编辑器侧要求文件里有**顶层** `@is Name` 才提供契约能力；而本项目内容靠
  `site/content/site.sml` 的 `contracts{}` 默认映射，且 `@is` 在 builtin 后端下会**解析报错**（见上一条）。
  团队约定：**不用 include 的内容，应用契约一律走 `contracts{}` 默认映射**，不写 `@is`。
  例外：内容里写了 `include ... as ns` 时，用 `@is ns.契约名` 是**唯一**能引用被包含契约的写法
  （规范 §4.4），此时该内容只能用 native 构建 —— 也就是上面那条约束。
- **以下是"编辑器专属"，构建侧不认**，不要在内容里使用：
  - `@type`（自定义类型模式）：扩展支持（悬浮/补全），构建侧 Python 解析器**零支持**；
  - `typed-block`（`契约名 块名 { }`）：上游 opt-in 特性，**只有 Rust/JS 实现**，本项目默认特性位不含它，
    builtin 下**静默失效**（实测：写法能解析，但 contracts 为空且不报错）；
  - `@feature enable …`：同上，Python 侧等同上游 C/Lua 档位。
- **扩展只覆盖 `.sml`**：本站内容大部分是 Markdown（`posts/**/index.md`），
  编辑器的实时诊断**不能替代** `python engine/cli.py build`。
- **跨文件契约是编辑器侧的短板**（2026-10-19 实测）：上游 §4.6 明确 JS 的 include 展开
  **不带回子文件契约表**，所以编辑器里 `@is blog.Resource` 可能报「未定义」，而 `build` 全绿
  （桥接层把契约拉回了 Python 侧）。**以 `build` 为准**，别为迁就编辑器改内容。
- 已知风险（未修，值得单独排期）：编辑器用的是**上游契约校验**，构建用的是 **Python 侧重写**的校验，
  两套实现可能漂移（例如内容在编辑器里全绿、`build` 却报 E-CONTRACT-*）。
  可加"契约分叉守卫"：用扩展包内的解析器（`src/vendor/sml.mjs`）跑 `contracts/*.sml`，
  与 `contract.describe()` 的输出逐项比对字段名/类型/required，不一致就让构建失败。

## 7. 当前内容类型与默认契约（site.sml: contracts{}）

| 目录 | 契约 | 必填字段（摘要） |
|---|---|---|
| posts/ | BlogPost | title author date tags summary |
| pages/ | Page | title group order |
| topics/ | Topic(loose) | title summary |
| members/ | Member(loose) | name |
| services/ | Service | name owner skills contact status updated |
| projects/ | Project | name one_liner repo status |
| resources/ | Resource(loose) | title kind url |
| weekly/ | Weekly(loose) | period title |
| quotes/ | （无契约，构建期限额） | text（source 可选） |

nav 顺序：`library knowledge topics projects resources members services weekly pages join`。

- `updated` 不来自 git：不写就取 `date`（`build.py:322` 的 `pick(d, ["updated"], date)` —— build 全流程
  没有任何 git 调用，manifest 实测 `updated == date`）。改稿后要显示「更新于」必须手写 `updated:`；
  `docs/ARCHITECTURE.md` 里「缺省取 git 最后提交时间」的说法**尚未实现**。

## 8. 排错入口

- 构建报 `E-CONTRACT-xxx`：字段缺/类型错/枚举越界，错误信息带文件路径与人话，直接按提示改内容或契约。
- `check.py` 失败：先跑 `build.py`；产物类失败多为 manifest 与 dist 不同步。
- 字体告警（缺 brotli/fonttools）：仅影响子集格式（woff 兜底），`rep.warn` 不参与退出码，不影响构建结论；但 `--warn-only` 会把所有错误一起降级成告警，别拿它当常规开关。
