# rec-blog 架构与内容规格（v0.1 草案）

站名：**Rust嵌入式探讨** ｜ 域名：`rec-blog.swebase.cn`（CNAME → `swe.os.kg`）
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
│  ├─ build.py check.py preview.py cli.py test_contracts.py config.py
│  ├─ test_render_safety.py test_structure.py verify_parity.py ai_summarize.py
│  ├─ fonts_import.py git_ready.py gui.py gui_api.py
│  └─ lib/{sml,_swsml,markdown,render,contract,mindmap,mathml,summary,urls,repo_meta}.py
├─ gui/                          # 写作台（Rust 启动器 + 内嵌 Web UI）
├─ tests/                        # 前端验收（Node）+ 写作台 API 回归（Python）
├─ deploy/                       # 自托管链路（entrypoint / webhook / fonts-crypt）
├─ Cargo.toml / Cargo.lock       # Rust workspace（members=["gui"]）
├─ site/                         # 本站点本身
│  ├─ content/                   #   人写的内容
│  │  ├─ site.sml                #   站点配置（站名/标语/导航/公告/群信息/默认契约映射）
│  │  ├─ posts/<year>/<slug>/index.(md|sml) + assets/
│  │  ├─ pages/<name>.sml        #   站文档：group + order 决定文档树
│  │  ├─ topics/<id>.(md|sml)    #   主题词条：同标签文章自动归入
│  │  ├─ members/<id>.sml        #   成员档案（同目录 <id>.jpg 自动作头像）
│  │  ├─ services/<id>.sml       #   能力与合作黄页（纯展示）
│  │  ├─ projects/<id>.sml       #   项目（构建期抓仓库元数据）
│  │  ├─ resources/<id>.sml      #   资源库
│  │  ├─ weekly/YYYY-Wnn.sml     #   周报 / 月刊
│  │  └─ contracts/*.sml         #   内容契约（字段即文档）
│  ├─ theme/                     #   前端壳（index.html / app.js / style.css）
│  ├─ fonts/                     #   自托管字体：src/ 与 subset/ 均 gitignore，
│  │                             #   CI 解密加密包（FONT_PASSWORD）后构建期子集化
│  ├─ meta/repos.json            #   仓库元数据缓存（入库）
│  └─ *.jpg                      #   群 logo（同时作为站点 favicon）
├─ docs/                         # 开发者文档（ARCHITECTURE / DEPLOY / FONTS / GOVERNANCE /
│                                #  ROADMAP / WORKFLOW / SELF-HOST / GUI）
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

前端：`index.html` 壳 + `app.js` 拉 `manifest.json` 做路由（首页/文章/项目/成员/资源/周报/群/搜索/标签归档），正文按 URL fetch 预渲染好的 HTML 片段；**投稿文本一律走文本节点，只有构建期预渲染的片段允许 `innerHTML`（构建侧已统一转义 + URL 白名单，`engine/lib/urls.py`）**。

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

- **SML 解析**：自写 Python 子集解析器（`engine/lib/sml.py`），零第三方依赖、不在 CI 里编 Rust
  （原生加速 `engine/native/sml.dll` 可选，缺失自动回退内置解析器）
- **仓库元数据**：仅构建期抓取，写进 manifest 并缓存 `meta/repos.json`，失败降级 stale
- **内容树**：两层（series → 文章），不设分类层；跨文章聚合走标签归档
- **托管**：Cloudflare Pages，主域 `rec-blog.swebase.cn`、别名 `rust-embed.swebase.cn`

## 9. 导图目录（已实现）

构建期为**站点树**与**每篇文章的章节树**生成可点击 SVG，不依赖任何外部 SML 工具：

- 生成器：`engine/lib/mindmap.py`（整齐树布局：子树高度定 y、列宽定 x、贝塞尔连线）
- 产物：`dist/map.svg`、文章 `dist/p/<slug>.map.svg`（front matter 写 `map: true` 才生成，默认关）、
  词条 `dist/topics/<id>.map.svg`、黄页 `dist/services/<id>.map.svg`、
  周报/文档页 `dist/w/<id>.map.svg` / `dist/pages/<id>.map.svg`（含自动生成的契约页）
- 交互：节点包 `<a href="#/...">`，点击走 hash 路由；侧栏「目录 / 导图」切换，SVG 内联注入后锚点生效
- 文章导图锚点为 `#/post/<slug>/<anchor>`，直接跳到对应章节

## 10. 投稿格式：Markdown 与 SML 双轨

- **默认 Markdown**（`index.md`）：front matter（YAML 子集）+ 正文。群友不需要学 SML。
- **可选 SML**（`index.sml`）：需要严格契约校验或结构化块（theorem/proof/math）时用。
- 两者出口统一：`render_body()` 返回 `(html, toc)`，因此**样式、章节树、导图、搜索索引完全共用**。
- Markdown 渲染器 `engine/lib/markdown.py` 支持：标题、段落、围栏/缩进代码、引用、有序/无序列表（一层嵌套）、
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
| `@contract` / `@is` 契约校验 | 是（走 `contracts{}` 默认映射） | 内容文件里不写 `@is`（builtin 后端会报错）；字段校验由 `lib/contract.py` 统一做，报错信息带错误码 + 人话 |
| `include` / glob / regex 包含 | 不用 | 内容自包含更简单；跨文件复用用片段即可 |
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
`python engine/test_contracts.py` 是契约引擎自测（断言数动态计数，钉住每一类错误码）。

## 13. 与 sml 上游的关系

本项目**不以 `smltools` 为主导**：只借用 SML 的语法（块/字段/数组/裸块/注释/内联角色约定），
解析与渲染全在仓库内自实现，因此可以自由扩展（例如本节的 SVG 导图、B 站视频块）。
上游那份改动建议（html 后端补 code/table、`--fragment`、front matter 透传、`--toc json`）
仍可选做，但不再是本项目的阻塞项。
