# AGENTS.md — 仓库索引（给 AI  Agent 的入口）

> 本文件是**仓库级索引**：另一个 AI 接手本仓库时先读这里，再按指针读细节。
> 站点内容级的 AI 可读索引是构建产物 `dist/llms.txt` / `dist/llms-full.txt`，不要混淆。
> 人类向文档：`README.md`（上手）、`engine/README.md`（工具体系）、`docs/ARCHITECTURE.md`（架构）。

## 1. 这个仓库是什么

QQ 群「Rust嵌入式探讨」的共建博客。内容 = Markdown（默认）或 SML 文件，
`engine/` 在**构建期**做契约校验 + 预渲染，产出纯静态站点到 `dist/`（hash 路由，零后端、零运行时框架）。
engine 与站点内容完全解耦：换 `site/` 目录即可复用到别的站点（`--site` 或 `REC_BLOG_SITE`）。

## 2. 目录索引

```
rec-blog/
├─ engine/                 可复用工具体系（不认识任何具体内容，只认目录约定）
│  ├─ config.py            站点定位：SITE/CONTENT/THEME/OUT/CACHE 路径约定；--site 参数
│  ├─ build.py             构建主流程：校验 → manifest → 预渲染 → 索引/RSS/sitemap/llms/字体子集
│  ├─ check.py             产物自检不变量（CI 用）；只读 dist/、不比对源码时间戳，dist/ 缺失直接退出
│  ├─ cli.py               命令行入口：new / list / contracts / build / check / test / preview
│  ├─ test_contracts.py    契约引擎自测（错误码语义，对齐 SML 上游 sml-codes）
│  ├─ test_render_safety.py 渲染安全回归（契约页转义 / 内联角色 / 嵌套列表 / --out 守卫）
│  ├─ preview.py           本地静态服务（后台运行 + 日志，默认 127.0.0.1:8080）
│  ├─ fonts_import.py      从字体包挑权重到 site/fonts/src/（不整包解压）
│  ├─ git_ready.py         入库前检查 / 本地提交（不 push；大文件与忽略规则检查）
│  ├─ native/sml.dll       SML 原生加速载体。engine/native/ 已 gitignore：干净克隆没有它，
│  │                       自动回退内置解析器（零依赖，CI 不装 Rust）；可用 SML_LIB /
│  │                       REC_BLOG_SML_LIB 环境变量指定库路径
│  └─ lib/
│     ├─ sml.py            SML 子集解析器（片段 &、契约 @contract/@is；builtin/native 双后端，可改）
│     ├─ _swsml.py         SML 原生绑定：vendored from swsml 0.6.4（MulanPSL-2.0）。别就地
│     │                    「改进」上游行为，升级 vendor 时以上游为准
│     ├─ markdown.py       Markdown 子集（front matter、:::note 提示块）
│     ├─ render.py         SML 块 → HTML（内联角色、B 站视频白名单）
│     ├─ contract.py       契约校验（E-CONTRACT-001–006、008；007 在码表里不存在）
│     ├─ mindmap.py        导图 SVG 生成（整齐树布局）
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
│  │  └─ contracts/*.sml   内容契约（字段即文档；自动生成契约文档页）
│  ├─ theme/               前端壳：index.html + app.js（路由/视图）+ style.css
│  ├─ fonts/               自托管 MiSans 子集：src/ 放源字体（已 gitignore，15 MB×2）；
│  │                       subset/ 子集入库（约 127 KB×2，CI 直接复用）；许可随产物发布
│  └─ meta/repos.json      仓库元数据缓存（入库）
├─ docs/                   ARCHITECTURE / DEPLOY / FONTS / GOVERNANCE / ROADMAP
├─ dist/                   构建产物（gitignore；固定输出到 <repo>/dist）
├─ LICENSE / LICENSE-CONTENT / CONTRIBUTING.md
├─ .github/                CI（build.yml 四步门禁 + sync-from-gitee.yml 镜像）+ PR 模板（无 Issue 模板）—— 勿动
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
  但**没有 URL 协议白名单**：`{link:}` 内联角色、SML `a`/`img` 块、Markdown `[x](url)`/`![alt](src)`
  五处出口都不校验协议，`javascript:` / `data:` 会原样进 href/src（实测：
  `render.inline('{link:javascript:alert(1)}')` → `<a href="javascript:alert(1)">`）。
  新增任何拼 href/src 的代码必须加协议白名单（http/https/mailto…）——这是当前最大的安全缺口。
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
```

提交前四连（与 `.github/workflows/build.yml` 的门禁逐步一致）：
`python engine/test_contracts.py` → `python engine/test_render_safety.py` →
`python engine/build.py` → `python engine/check.py`，全绿才算完成。
注意：CI 跑的是**联网** build（元数据抓取失败不中断，回退 `meta/repos.json` 缓存）；
本地求快可加 `--offline`，但抓取降级路径只在联网构建里能复现。
另：`cli.py test` 只跑 `test_contracts.py`；渲染安全回归要直接跑 `engine/test_render_safety.py`。

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
- 黄页（services）性质：纯展示，**不参与交易、不担保、不抽成、不经手资金、不介入纠纷**；
  contact 只能引用成员档案 `links` 里本人已公开的字段，不得新收集个人信息；不设计支付/订单/撮合/站内私信/账号体系。
- `--out` 只会清空目标目录：`guard_out()` 拒绝仓库根/站点目录**及其上级**、仓库内非 dist 位置；放行仓库外目录与 `dist/` 子树。
- 契约错误码语义由 `test_contracts.py` 钉住，改 `lib/contract.py` 必须同步用例。
- 已知缺陷（未修）：`lib/sml.py` 内置解析器报错行号偏 1 —— `entry()` 在 `p.skip()` **之后**才取 `head`，
  所以单行文件的「多余的值」会报 `line=2`。投稿者按行号定位会找错一行，修时顺手加一条用例。
- 解析器内部字段（`__is` / `__md_body` / `__type`；注意 `__type` 在每个 SML 块上，不只是文件顶部）以 `_` 前缀统一被挡在 manifest 外（check.py 有断言）。

### 6.1 契约与编辑器（VS Code 扩展）的分工（2026-10-16 实测）

- **`@contract` 要用**：它是唯一"两边都认"的东西 —— 构建侧由 `lib/sml.py:_parse_contract_body` 解析
  （字段类型 / `optional` / `enum` / `min` / `max` / `default` / `loose`），编辑器侧由
  `snoware.sml-lang` 扩展（`~/.vscode/extensions/snoware.sml-lang-0.4.3`，随上游 `sml` 仓走）读取，
  用于**悬浮契约名看默认值展开、字段补全、以及编辑器内契约语义校验**。改契约 = 同时改校验、错误提示、文档页。
- **`@is` 别用**：编辑器侧要求文件里有**顶层** `@is Name` 才提供契约能力；而本项目内容靠
  `site/content/site.sml` 的 `contracts{}` 默认映射，且 `@is` 在 builtin 后端下会**解析报错**（见上一条）。
  团队约定：**应用契约一律走 `contracts{}` 默认映射**，不在内容文件里写 `@is`。
- **以下是"编辑器专属"，构建侧不认**，不要在内容里使用：
  - `@type`（自定义类型模式）：扩展支持（悬浮/补全），构建侧 Python 解析器**零支持**；
  - `typed-block`（`契约名 块名 { }`）：上游 opt-in 特性，**只有 Rust/JS 实现**，本项目默认特性位不含它，
    builtin 下**静默失效**（实测：写法能解析，但 contracts 为空且不报错）；
  - `@feature enable …`：同上，Python 侧等同上游 C/Lua 档位。
- **扩展只覆盖 `.sml`**：本站内容大部分是 Markdown（`posts/**/index.md`），
  编辑器的实时诊断**不能替代** `python engine/cli.py build`。
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

nav 顺序：`library knowledge topics projects resources members services weekly pages join`。

- `updated` 不来自 git：不写就取 `date`（`build.py:322` 的 `pick(d, ["updated"], date)` —— build 全流程
  没有任何 git 调用，manifest 实测 `updated == date`）。改稿后要显示「更新于」必须手写 `updated:`；
  `docs/ARCHITECTURE.md` 里「缺省取 git 最后提交时间」的说法**尚未实现**。

## 8. 排错入口

- 构建报 `E-CONTRACT-xxx`：字段缺/类型错/枚举越界，错误信息带文件路径与人话，直接按提示改内容或契约。
- `check.py` 失败：先跑 `build.py`；产物类失败多为 manifest 与 dist 不同步。
- 字体告警（缺 brotli/fonttools）：仅影响子集格式（woff 兜底），`rep.warn` 不参与退出码，不影响构建结论；但 `--warn-only` 会把所有错误一起降级成告警，别拿它当常规开关。
