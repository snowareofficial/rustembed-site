# rec-blog 架构与内容规格（v0.1 草案）

站名：**Rust嵌入式探讨** ｜ 域名：`rustembed.swebase.cn`（CNAME → `swe.os.kg`）
权威仓库：`gitee.com/rustembed/site`（**只走 Gitee**）
构建发布：Gitee 权威 + 单向镜像到 GitHub，GitHub Actions 构建 → Pages 托管（静态）

## 0. 三条硬约束

1. **Pages 静态、仓库动态**：托管侧只有静态文件，一切动态（manifest、索引、预渲染、仓库元数据抓取）都在仓库/CI 侧完成。
2. **构建期预渲染**：`.sml` 在构建时转成 HTML 片段，前端只拉 `manifest.json` + HTML 片段做路由与排布，不在浏览器里解析 SML。
3. **投稿 = PR**：群管理有 push 权限；群员可 fork 提 PR，也可把稿交给有权限的群管理代投（署名仍归作者）。不做评论系统，讨论引流回 QQ 群。

## 1. 目录规范（2026-09-19 收束）

两块分明：**engine（可复用工具）与 site（本站点）**，外加 docs（开发者文档）与 dist（产物）。
人只需要动 `site/content/`。

```
rec-blog/
├─ engine/                       # 工具体系：不含本站知识，可整体复制复用
│  ├─ build.py check.py preview.py cli.py          # 入口脚本
│  ├─ core/  parse/  render/     # 约定 / 解析 / 渲染（只向下依赖，不反向）
│  ├─ content/  pipeline/        # 内容类型 / 产物出口
│  ├─ tools/  tests/             # 辅助脚本 / 引擎自测
│  ├─ native/ vendor/            # SML 原生库、vendored 依赖
├─ archive/gui/                  # 已归档的写作台（2026-10-28，只读）
├─ tests/                        # 验收脚本（Node 前端 + 三个 Python harness）
├─ deploy/                       # 自托管链路（entrypoint / webhook / fonts-crypt）
├─ site/                         # 本站点本身
│  ├─ content/                   #   人写的内容
│  │  ├─ site.sml                #   站点配置（站名/标语/导航/公告/群信息/默认契约映射）
│  │  ├─ posts/<year>/[series/]<slug>/index.(md|sml) + assets/
│  │  ├─ pages/<name>.sml        #   站文档：group + order 决定文档树
│  │  ├─ topics/<id>.(md|sml)    #   主题词条：同标签文章自动归入
│  │  ├─ members/<id>.sml        #   成员档案（同目录 <id>.jpg 自动作头像）
│  │  ├─ services/<id>.sml       #   技术互助（纯展示）
│  │  ├─ projects/<id>.sml       #   项目（构建期抓仓库元数据）
│  │  ├─ resources/<id>.sml      #   资源库
│  │  ├─ weekly/YYYY-Wnn.sml     #   周报 / 月刊
│  │  └─ contracts/*.sml         #   内容契约（字段即文档）
│  ├─ theme/                     #   前端壳（index.html + css/ + js/；顺序见 index.html）
│  ├─ fonts/                     #   自托管字体：src/ 与 subset/ 均 gitignore，
│  │                             #   CI 解密加密包（FONT_PASSWORD）后构建期子集化
│  ├─ meta/repos.json            #   仓库元数据缓存（入库）
│  └─ *.jpg                      #   群 logo（同时作为站点 favicon）
├─ docs/                         # 开发者文档（ARCHITECTURE / DEPLOY / FONTS / GOVERNANCE /
│                                #  ROADMAP / WORKFLOW / SELF-HOST）
└─ dist/                         # 产物（gitignore）
```

- 站点根可换：`--site <目录>` 或环境变量 `REC_BLOG_SITE`；找不到 `<repo>/site` 时回退到仓库根（兼容单目录布局）。
- 内容页识别规则：扩展名 `.sml` / `.md` / `.markdown`；跳过 `README`/`ARCHITECTURE` 等项目文档与 `_` 前缀文件。
- `engine/README.md` 是工具侧的入口文档：每个文件的职责 + 「加一个内容类型 / 加一个块类型」的具体步骤。

## 2. 内容模型（字段表）

### BlogPost（`posts/**/index.sml`）

| 字段 | 必填 | 说明 |
|---|---|---|
| title | 是 | |
| slug / id | 是 | 由目录名推导，也可显式写 |
| author | 是 | 引用 `members/<id>` |
| co_authors | 否 | 成员 id 数组 |
| date | 是 | 首次发布 |
| updated | 否 | 缺省取 `date`（构建不读 git；改稿后要显示「更新于」必须手写 `updated:`） |
| tags | 是 | 字符串数组 |
| summary | 是 | 一两句，列表页与 OG 描述用 |
| license | 否 | 缺省继承站点默认许可 |
| draft | 否 | true 时不进 manifest |
| series | 否 | `{id, order}`，树状结构用 |
| attachments | 否 | 见第 4 节 |
| video | 否 | B 站 BV 号，构建期白名单校验 |

### Project（`projects/<id>.sml`）

| 字段 | 必填 | 说明 |
|---|---|---|
| name / one_liner | 是 | |
| repo | 是 | 仓库 URL |
| host | 否 | `github` / `gitee` / `codeberg` / `gitea`（缺省按 URL 推断）|
| homepage / docs | 否 | |
| languages / platforms | 否 | 筛选用 |
| tags | 否 | 展示标签（技术标签 / 编辑标签），列表过滤与搜索都含；`active` 自动补「活跃开发」 |
| status | 是 | `active` / `archived` / `wip` |
| license | 否 | |
| owner / contributors | 否 | 成员 id，反查到个人页 |
| featured | 否 | 首页精选 |
| meta_source | 否 | `auto`（默认）/ `manual` |
| meta_override | 否 | 手工覆盖自动抓取的字段 |

### Member（`members/<id>.sml`）

| 字段 | 必填 | 说明 |
|---|---|---|
| id | 是 | **固定 id**，URL 用 `/members/<id>` |
| name | 是 | 群昵称 |
| avatar | 否 | 缺省用占位图 |
| signature | 否 | 个性签名 |
| role | 否 | 群主/管理/贡献者/群友 |
| skills | 否 | 标签数组 |
| links: blog / github / gitee / email | 否 | **由本人提供，默认授权展示**；`email` 单独可设 `hide: true` |
| joined | 否 | |

### Resource / Weekly / Site（略，字段见 `contracts/`）

- **Resource**：title、kind（route/book/tool/video/course）、url、tags、note
- **Weekly**：period、title、highlights[]、merged_posts[]、contributors[]
- **Site**：title、tagline、nav[]、announcement、group{qq, name, avatar, rules, features[], timeline[]}

## 3. 树状文章结构（目录式 + 章节式一体栏）

侧栏一个组件、两种内容：

- **目录式（站点树）**：按 `series` → 文章、或按 分类/年份/标签 展开的树，可折叠
- **章节式（本文树）**：由文章内 `topic`/`section` 生成的章节树，带 `label` 锚点

交互：当前页定位自动展开 + 高亮，滚动联动（scrollspy）；系列文章在详情页底给出「上一章 / 下一章」。

> 待确认：除「系列」外是否需要独立的**分类/专栏**层级；若需要，`series` 之上再加 `collection` 字段。

### 3.1 标签页里的系列（`#/library?tag=x`）

标签页把「同一 series 的多章」收成**一条带标记的文章行**（`<details>` 展开即全部章节）。
判定口径（2026-10-20 定，`site/theme/js/views.js: viewLibrary()`）：

- **系列总章数 > 1 就合并**，与「这一章是否命中当前标签」无关。系列是「一份文档」，
  组里有一章命中就说明这组与该标签相关，整组呈现比只露一章有用；
  反过来**单章系列没有"组"的意义，退化成普通文章行**（不会出现"系列 · 1 章"）。
- 只有部分章节命中时，徽章会补一句「（命中 N）」—— 徽章的「N 章」是系列章数，
  不是该标签下的篇数，不写清楚会让人以为 N 章都讲这个标签。
- 年份分组取「系列最新一章」的日期（与系列行摘要里的日期同源），
  于是系列跨年份也落在最新一章那年，展开后章节列表仍是完整的全组。
- 无标签的书库页（`#/library`）**不合并**：那里没有筛选语义，合并只会让篇数统计失真。
- 过滤（`data-filter` + `data-rowclass`）命中系列标题 / 任一章标题 / 任一标签即整行显示，
  否则整行隐藏；切回空查询恢复。`data-rowclass` 保证隐藏后仍带 `row-series` 类。

回归：`node tests/series_tag_test.js`（DOM 桩，含 100 篇 / 10 系列的性能档）与
`node tests/browser-check.js`（真实 CSS：徽章、展开、375px 不溢出）。

### 3.2 成员页文章列表（`#/member/<id>`）

文章数 **> 6** 时，列表上方自动加「本页搜索框」并把列表套进 `.rows-scroll`
（`max-height: 24rem; overflow-y: auto`）；**≤ 6** 篇时保持原样，不占空间。
阈值写死 6 的理由：成员页是「这个人写了什么」的速览，一两屏能看完，
加搜索框反而挡内容；只有长到要滚的时候才值得给它一个入口。
搜索按标题 / 摘要 / 标签过滤（`filterable()`），空查询全量。

## 4. 附件规则

- **图片入库**：`posts/<slug>/assets/`，类型白名单 `png/jpg/jpeg/webp/gif/svg`，单文件与单篇总量设上限
- **其余一律外链**：压缩包 / PDF / 固件 / 数据集由作者自备链接，构建期只校验「是合法 URL + 有标题 + 有大小说明」，不下载、不落盘
- 附件与文章同 PR 提交、随文章一起审
- 命名 `<slug>-<序号>-<语义名>.<ext>`
- 附件全部登记进 manifest，前端展示「名称 + 类型 + 大小 + 来源」

## 5. 仓库元数据自动获取

支持 **GitHub / Gitee / Codeberg / 自托管 Gitea**（含 Gitea 系，API 路径可配置）。

- **构建期拉取**（推荐）：CI 有稳定外网，结果写进 manifest 并缓存 `meta/repos.json`；前端零 API 依赖、无 CORS 与限流问题
- 抓取字段：stars / forks / 语言 / 许可 / **最近更新时间** / 描述 / 归档状态 + `fetched_at`
- 降级策略：接口失败 → 用上次缓存 → 再失败则只显示仓库链接，构建不失败
- `meta_source: manual` 或 `meta_override` 可手工覆盖任意字段
- 未鉴权调用有速率限制，构建里**串行**抓取（无节流；单个仓库 10s 超时，失败降级缓存）

## 6. 构建流水线（`engine/build.py`）

```
扫目录 → @contract 校验必填字段 → 附件/图片检查（类型、体积、存在性）
  → 拉仓库元数据（带缓存） → SML 解析 → 预渲染 HTML 片段
  → 产出 manifest.json / search-index.json / sitemap.xml / feed.xml → dist/
```

前端：`index.html` 壳 + `site/theme/js/`（core 建 `window.REC` 命名空间 → 各模块挂导出 → app.js 入口装配启动）拉 `manifest.json` 做路由（首页/文章/项目/成员/资源/周报/群/搜索/标签归档），正文按 URL fetch 预渲染好的 HTML 片段；**投稿文本一律走文本节点，只有构建期预渲染的片段允许 `innerHTML`（构建侧已统一转义 + URL 白名单，`engine/core/urls.py`）**。

## 7. SML 工具链调研结论与改动建议

**可复用**：`smltools --to md`（topic/section→h1~h6+`label` 锚点、内联角色、code/table/列表、theorem/proof/math）、目录批量、退出码 0/1/2、`@contract` 校验。

**建议给 sml 项目提的改动**：
1. html 后端加 `--fragment` / `--template`
2. front matter 支持透传 `date/updated/tags/author/summary/draft`（当前 date 硬编码 1970-01-01）
3. html 后端补齐 `code`/`table`/`ul`/`ol`/`a`/`theorem`
4. 新增 `video` 与 `attachment` 块（带域名白名单）
5. 新增 `--toc json` 输出章节树（喂一体栏）

**注意**：`@import` 是文本内联、不是对象合并，不能用来拼数据；`@contract` 校验后取字段只有 `Value::get("a.b.c")` + `as_str()`。

## 8. 已定项（2026-09-19）

- **SML 解析**：自写 Python 子集解析器（`engine/parse/sml.py`），零第三方依赖、不在 CI 里编 Rust
  （原生加速 `engine/native/sml.dll` 可选：缺失时不含 `include` 的内容照常构建、含 `include`
  的内容明确报错；有的话它额外负责 include / 命名空间的展开，见 §14）
- **仓库元数据**：仅构建期抓取，写进 manifest 并缓存 `meta/repos.json`，失败降级 stale
- **内容树**：两层（series → 文章），不设分类层；跨文章聚合走标签归档
- **托管**：Cloudflare Pages，生产域名 `rustembed.swebase.cn`（默认域名 `rustembed.pages.dev`）

## 9. 导图目录（已实现）

构建期为**站点树**与**每篇文章的章节树**生成可点击 SVG，不依赖任何外部 SML 工具：

- 生成器：`engine/render/mindmap.py`（整齐树布局：子树高度定 y、列宽定 x、贝塞尔连线）
- 产物：`dist/map.svg`、文章 `dist/p/<slug>.map.svg`（front matter 写 `map: true` 才生成，默认关）、
  词条 `dist/topics/<id>.map.svg`、技术互助 `dist/services/<id>.map.svg`、
  周报/文档页 `dist/w/<id>.map.svg` / `dist/pages/<id>.map.svg`（含自动生成的契约页）
- 交互：节点包 `<a href="#/...">`，点击走 hash 路由；侧栏「目录 / 导图」切换，SVG 内联注入后锚点生效
- 文章导图锚点为 `#/post/<slug>/<anchor>`，直接跳到对应章节

## 10. 投稿格式：Markdown 与 SML 双轨

- **默认 Markdown**（`index.md`）：front matter（YAML 子集）+ 正文。群友不需要学 SML。
- **可选 SML**（`index.sml`）：需要严格契约校验或结构化块（theorem/proof/math）时用。
- 两者出口统一：`render_body()` 返回 `(html, toc)`，因此**样式、章节树、导图、搜索索引完全共用**。
- Markdown 渲染器 `engine/render/markdown.py` 支持：标题、段落、围栏/缩进代码、引用、有序/无序列表（一层嵌套）、
  表格、水平线、图片（可带图注）、链接、粗体/斜体/删除线/行内代码、单独一行的 B 站视频，
  以及 SML 的内联角色；正文 HTML 一律转义（`check.py` 会验证片段里没有 `<script>`）。
- **Hugo 的位置**：当前不需要。若将来要完整 CommonMark（脚注、定义列表、自动链接）或复杂排版，
  把 `markdown.render()` 换成外部引擎（Hugo / pandoc / python-markdown）即可 —— 出口签名保持 `(html, toc)`，
  站点其余部分（manifest、路由、CSS）不用动。之所以不默认引入 Hugo：本站是自制 SPA，
  Hugo 的模板/资源管线用不上，只当 Markdown→HTML 片段转换器的话，反而不如内置子集稳且无二进制依赖。
- 目录下 `README.md` / `ARCHITECTURE.md` 等项目文档不会被当作内容页（`docs_in()` 跳过名单），
  内容页可用 `_` 前缀临时排除。

## 11. 吸收的 SML 写作能力（对人友好）与文档树

上游 SML 的能力清单来自 `rust/sml-feature/src/lib.rs`（15 项特性位）。本项目**按需吸收**：

| 能力 | 采用 | 说明 |
|---|---|---|
| 裸词即字符串（含中文、邮箱、`a/b/c`） | 是 | `state: NY`、`to: a@b.c` 都不用引号 |
| 块冒号可省 / 裸块带头文本 | 是 | `address { }` ≡ `address: { }`；`topic 导言 { }` 的「导言」是 `__name` |
| 数组灵活（逗号可选、可换行、可混排） | 是 | 正文按顺序渲染靠数组 |
| 注释 `#` `--` `//` 与 `/* */` `_* *_` | 是 | 行内注释也可用 |
| **多行字符串**（引号内直接换行） | 是 | 写整段正文不用 `\n`，站点里的 SML 页面就是这么写的 |
| **片段 `@frag {}` + `&frag`** | 是 | 值级展开：`links: &sal_links`（成员档案在用） |
| `@version` 等指令行 | 忽略 | 解析时丢弃，不报错 |
| `@contract` / `@is` 契约校验 | 是（走 `contracts{}` 默认映射） | 内容文件里不写 `@is`（builtin 后端会报错）；字段校验由 `engine/core/contract.py` 统一做，报错信息带错误码 + 人话 |
| `include "x.sml" [as ns]` 包含 | 是（仅文件入口 + native） | 跨文件复用契约/数据；沙箱 = 包含者所在目录子树（§14） |
| glob / regex / 挑键 / 多目标 include | 不支持 | 桥接层直接拒绝（native 能展开数据但契约拉不回来） |
| `$env.VAR` 环境变量内插 | 不用 | 静态站点不需要，且容易把密钥带进产物 |
| `@when` / `@for` / typed-block | 不用 | 那是配置模板能力，对投稿只有噪音 |

**文档树**：`site/content/pages/*.sml` 声明 `group` 与 `order`，构建期产出分组后的 `manifest.pages`，
前端「文档」页与侧栏按 group 折叠展示，站点导图 `map.svg` 里也是同样的分组层级；
每页另有 `pages/<id>.map.svg` 章节导图。顺序、归组都在内容文件里定，不需要改代码。

## 12. 内容契约（`@contract` / `@is`）：字段即文档

契约不是「额外校验脚本」，而是**内容的 schema 与其文档本体**：定义在 `site/content/contracts/*.sml`，
改一处同时改三件事 —— 校验规则、错误提示、站点上的「文档 → 规范 → 内容契约」页（自动生成）。

```
@contract BlogPost {
  title: str              # 标题
  date: date              # 首次发布日期
  tags: [str]             # 标签，至少一个
  series: Series optional # 系列：自动进侧栏树
}
@contract Series {
  id: str
  order: int min 0
}
```

应用方式：
1. **默认映射**（推荐，团队约定只走这条）：`site/content/site.sml` 里 `contracts { post: BlogPost … }`，按内容类型自动生效；
2. **显式应用**：文件里写 `@is BlogPost`（覆盖默认）。**注意**：内置解析器对顶层 `@is` 支持不完整
   （VS Code 扩展认、builtin 后端会报错），投稿内容请不要写 `@is`，统一用 `contracts{}` 默认映射。

校验结果一律「**错误码 + 人话**」，形如：

```
site/content/members/sal.sml: E-CONTRACT-008 字段 `Member.links` 应为块并按契约 `MemberLinks` 校验，实为 str
```

码表（对齐上游 `sml-codes/src/codes.rs`）：

| 码 | 含义 |
|---|---|
| E-CONTRACT-001 | 未定义的契约 / 字段类型名未知 |
| E-CONTRACT-002 | 字段类型不符 |
| E-CONTRACT-003 | 必填字段缺失 |
| E-CONTRACT-004 | 未声明字段（严格模式；契约里写 `loose` 放宽） |
| E-CONTRACT-005 | 数值越界（`min` / `max`） |
| E-CONTRACT-006 | 枚举取值非法 |
| E-CONTRACT-008 | 组合字段应为块 |

其它：支持 `optional` / `default` / `[类型]` 数组 / 嵌套契约；字段行 `#` 后的文字会作为「说明」进入自动生成的文档页；
`python engine/build.py --contract-loose` 可临时把 `E-CONTRACT-004` 放宽（应急，不建议长期用）；
`python engine/tests/test_contracts.py` 是契约引擎自测（断言数动态计数，钉住每一类错误码）。

### 12.1 跨文件复用：`include` + 命名空间

内容文件（`.sml`）可以复用别的文件的契约与数据：

```
include "_shared.sml" as blog      # 下划线开头的文件不被 docs_in 收录，适合当共享契约盒
@is blog.Resource
title: "书"
kind: book
url: "https://example.com/"
```

规则（与 SML 规范 §4.4 / §4.6 / §4.7 对齐，实测 swsml 0.6.4）：

| 项 | 行为 |
|---|---|
| 路径基准 | 相对**包含者所在目录**；递归展开，同一文件多处包含只过一次 |
| `as ns` | 数据挂到命名空间键 `ns` 下；契约登记为限定名 `ns.契约名` |
| 内联（无 `as`） | 数据平铺合并；契约登记为裸 `契约名` |
| 命名空间隔离 | `as blog` 之后**只能**用 `@is blog.Resource`，裸 `Resource` 不再可见 |
| 允许根 | 目标 realpath 必须落在 **site/content** 内；跨兄弟目录（如 `resources/` → `contracts/`）可以 |
| 沙箱 | native 的沙箱更紧（基准 = 包含者目录），靠下面的**预处理**绕开，不放宽 native |
| 防护 | 循环 include → `E-INCLUDE-002`；嵌套 > 32 层 / 文件 > 64 个 / 总字节 > 8 MiB → 明确错误 |
| 契约谁校验 | 一律 Python 侧 `engine/core/contract.py`（native 不懂 url/date/image，见 §14） |

优先级：文件里的 `@is` > `site.sml` 的 `contracts{}` 默认映射，二者只走一个，不会重复报错。
「优先级」的落点在 `engine/core/contracts.py` 的 `apply_contract()`（唯一入口，构建与工具共用同一口径）。

不支持的写法（构建直接报错，不静默降级）：glob `*.sml`、正则 `re:"…"`、挑键 `{ a, b }`、
一行多目标 `"a", "b"`、点分模块名 `import a.b`、以及未加引号的路径。

## 13. 与 sml 上游的关系

本项目**不以 `smltools` 为主导**：只借用 SML 的语法（块/字段/数组/裸块/注释/内联角色约定），
解析与渲染全在仓库内自实现，因此可以自由扩展（例如本节的 SVG 导图、B 站视频块）。
上游那份改动建议（html 后端补 code/table、`--fragment`、front matter 透传、`--toc json`）
仍可选做，但不再是本项目的阻塞项。

## 14. 原生后端（native）与 include：谁负责什么

`engine/parse/sml.py` 有两条加载路径：

| 入口 | 谁在用 | 行为 |
|---|---|---|
| 文本入口 `parse_doc(text, path)` | 单测、无 include 的场景 | 不展开 include（撞上就报错，见 `_include_guard`） |
| 文件入口 `load_doc(path)` / `parse_doc_at(text, path)` | `engine/content/loader.py` 的 `load2()` | 内容含 include/import 时交给 native 展开 |

native = `engine/native/sml.dll`（swsml 0.6.4 的 Rust cdylib，`engine/native/` 已 gitignore）。
文件入口会额外打开 `include` + `namespace` 两个特性位（`as ns` 需要它）；`implicit-ns` **不开** ——
否则 `include "foo"` 会悄悄变成命名空间，与本站既有口径不一致。

**契约不交给 native 校验**，实测两条理由：

1. 类型系统不等价。native 遇到 rec-blog 的 `url` / `date` / `image` 会当作「契约名」去套
   ContractRef，报的是 `E-CONTRACT-008 字段 url 应为块并按契约 url 校验，实际为 str` ——
   它根本不会做格式检查；
2. 命名空间隔离缺失。`include "x.sml" as blog` 之后，native 把被包含文件的契约登记成**裸名**，
   于是规范 §4.4 规定的 `@is blog.Resource` 实测报 `E-CONTRACT-001 未定义的契约 blog.Resource`
   （反过来 `@is Resource` 却能通过）。

所以做法是：入口文件里的 `@contract` / `@is` 照旧在交给 native 前剥掉（`_strip_directives`），
native 只拿数据；被包含文件的 `@contract` 由 `bridge_contracts()` 沿 include 图走一遍
`_strip_directives` 拉回来，组成**旁路契约表**（`as ns` → `ns.契约名`），校验仍由
`engine/core/contract.py` 统一负责 —— 于是 url / date / image / 附件路径这些本站校验一条不少。

## 15. 跨目录 include 的预处理（为什么 native 沙箱要绕）

native 的沙箱基准是**包含者所在目录**：

```
site/content/resources/x.sml
  include "../contracts/blog.sml" as blog     # ⇒ E-INCLUDE-003
```

`resources/` 想去引用 `contracts/` 里的集中契约，native 直接拒。native 不改（非目标），
于是 rec-blog 在**交给 native 之前**先把 include 闭包落成一个临时扁平副本：

```
<系统临时目录>/rec-blog-include-xxxx/
    entry.sml              ← 入口副本（@contract/@is 已剥离）
    <sha1(原始绝对路径)[:12]>.sml   ← 闭包里每个被包含文件一份
```

并且把每个副本里的 include 行改写成**同级文件名**（`include "<hash>.sml" as blog`）——
native 看到的永远是「同目录 / 子目录」的 include，沙箱自然放行。
扁平化是必须的：如果把被包含文件放进子目录，它对入口的引用会变成 `../entry.sml`
⇒ 照样 E-INCLUDE-003（实测踩过）。

流程（`engine/parse/sml.py`）：

1. `scan_include_refs()` 扫顶层 include 行：`_code_lines()` 先把字符串与块注释
   内部的行掩掉，防止注释里伪造一行 `include` 就真去读文件；
2. `_safe_include_target()` 解析目标：禁绝对路径；`realpath` 必须落在
   **允许根** `config.CONTENT`（站点内容目录）内 —— 于是跨兄弟目录放行、
   逃出 `site/content`（含 symlink 指向根外）一律 `E-INCLUDE-003`；
3. `_walk_include_graph()` 遍历闭包：按「边」去重（菱形只复制一份），
   深度 > 32 / 文件数 > 64 / 总字节 > 8 MiB 报错，成环交给 native 报
   `E-INCLUDE-002`；
4. `prepare_include_tree()` 把闭包写进临时目录并改写路径（行号不变）；
5. native `load_file` 只解析**临时入口**；契约从**原始**文件收集，仍由
   `contract.py` 校验；
6. `finally` 里 `rmtree` 整个临时根目录。

临时目录位置 = `tempfile.mkdtemp()`（系统 temp），**不会**在 `site/content` 下
产生任何副本；文件名用原始路径 sha1 前 12 位，目的是避免不同目录的同名文件撞车，
不是保密。

错误可读性：native 报错里的临时路径会通过 `PreparedIncludeTree.reverse`
映射回原始文件（`_map_native_error`），作者看到的永远是自己的文件名 + 行号 + 错误码，
不会冒出 `C:\Users\...\Temp\...`；ctypes / OSError 等底层异常一律包成 `SmlError`
（`E-NATIVE-001`），不直接抛给投稿者。

### 15.1 CI 怎么保证真的跑到

`engine/native/` 是 gitignore 的，所以 CI 里默认**没有** native ——
过去 `test_sml_include.py` 就整组 SKIP，门禁形同虚设。现在：

- 新增 `.github/workflows/include-native.yml`：job `include-native` 先拉上游
  `v0.6.4` 并 `cargo build --release -p swsml`，把 cdylib 放进 `engine/native/`，
  再跑 `python engine/tests/test_sml_include.py`（[B][D][E] 真跑）；
- 脚本本身也改了口径：**缺 native 时退出码 1**（不再静默 SKIP），
  只有显式 `REC_BLOG_SML_ALLOW_NO_NATIVE=1` 才降级为跳过。
  于是「装不上 native」会红，而不是悄悄绿。

**native 缺失时的行为**（干净克隆、没装 cdylib 的机器）：

- 不含 include 的内容：照常构建，走内置解析器；
- 含 include 的内容：**构建失败**，报错 `E-FEATURE-001` 并说明怎么装 native。
  绝不静默把 `include "x.sml"` 当普通字段 —— 那样正文会变成垃圾数据。

已知限制：

- include 目标必须落在 **site/content** 内（这是本任务新定的允许根）。
  站内跨目录（如 `resources/` → `contracts/`）现在可以；指向内容目录之外
  （`../../Windows/...`、绝对路径、symlink 指到根外）一律 `E-INCLUDE-003`；
- 只支持规范子集 `include "路径"` / `include "路径" as ns`。glob、正则、挑键、
  一行多目标、点分模块名 `import a.b`、未加引号路径，全部**显式报错**
  （不静默降级 —— 静默会让契约悄悄不生效）；
- 被包含文件里若自带 `@is`，构建直接报 `E-PARSE` 错（不静默忽略）：
  当前实现只把入口文件的 `@is` 带回 Python 侧校验。要引用被包含文件里的契约，
  请用 `@is ns.契约名` 写在入口；或走 `site.sml` 的 `contracts{}` 默认映射；
- 上游 JS/VS Code 扩展的 include 展开不带回子文件契约表（§4.6），编辑器里
  `@is blog.Resource` 可能报未定义 —— 以 `python engine/cli.py build` 为准；
- 绕路扫描整个工作区找 `@contract` 的做法被明确禁止（会绕过命名空间），
  桥接只走真实的 include 图。
