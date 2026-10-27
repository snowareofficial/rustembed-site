# 仓库目录地图

先看这张表，再决定文件放哪。不要往根目录堆临时文件。
**内容树的路径约定以本文为准**；其他文档只引用，不复制细节。

```text
rec-blog/
├─ site/                       站点本身（换站点只换这个目录）
│  ├─ content/                内容：文章、成员、项目、资源、互助、页面、契约
│  │  └─ posts/<年>/
│  │     ├─ <短名>/            独立文章（两层）：index.md + assets/
│  │     └─ <系列>/<短名>/      系列文章（三层）：index.md + assets/
│  ├─ theme/                  前端壳：index.html + css/ + js/（加载顺序以 index.html 为准）
│  ├─ fonts/                  字体加密包、许可、子集输出（src/、subset/ 不入库）
│  └─ meta/                   仓库元数据缓存
├─ engine/                     构建引擎（与具体内容无关，可复用）
│  ├─ build.py check.py cli.py preview.py    入口（薄壳，路径稳定）
│  ├─ core/                   站点定位、路径表、内容树约定、契约表、URL 白名单、报告
│  ├─ parse/                  SML 解析（native / builtin 两个后端）
│  ├─ render/                 SML 块渲染、Markdown、LaTeX→MathML、导图 SVG
│  ├─ content/                内容类型：文章 / 项目 / 成员 / 一言 / 词条 / 互助 / 资源页
│  ├─ pipeline/               产物层：Out 收集器、manifest/feed、字体子集
│  ├─ tools/                  辅助脚本：AI 摘要、图片审计、字体导入、git 检查、native 编译…
│  ├─ tests/                  引擎自测：契约、include、渲染安全、结构、图片
│  ├─ native/                 sml.dll（gitignore；缺失自动回退 builtin）
│  └─ vendor/                 fontTools / latex2mathml（vendored）
├─ archive/gui/               已弃用的写作台（Rust + Python API + 视觉稿 + 任务书，只读）
├─ templates/                 给作者的复制模板（post / resource / project / member / service）
├─ tests/                     前端/接口验收（smoke、browser-check、i18n、技术互助、目录树）
├─ deploy/                    自托管：Docker entrypoint / build / fonts-crypt / webhook
├─ docs/                      设计与流程文档（见 docs/README.md）
│  └─ archive/                已完成的任务书/交接，不再维护
├─ .github/                   CI：build / publish-pages / include-native / sync-code
├─ .gitee/                    Gitee 的 PR/Issue 模板
├─ Dockerfile / .dockerignore
├─ README.md                  上手入口
├─ CONTRIBUTING.md            根入口：指向 docs/CONTRIBUTING.md
├─ AGENTS.md                  仓库级 AI/维护者索引
└─ LICENSE / LICENSE-CONTENT
```

## 内容树约定（唯一事实源）

```text
content/posts/<四位年份>/[<系列>/]<短名>/index.(md|sml)
content/posts/<四位年份>/[<系列>/]<短名>/index.<语言>.(md|sml)
```

| 规则 | 说明 |
|---|---|
| 第一层是年份 | 必须四位数字，否则 `E-POST-002` |
| 独立文章两层、系列文章三层 | 系列文章直接挂在年目录下 → `E-POST-003` |
| 同一系列只用一个目录名 | 分散在多个目录 → `E-POST-004` |
| 正文必须叫 `index.*` | 其他名字不会被收录（静默少一篇）→ `E-POST-001` |
| 叶子目录名 = slug = URL | **永不改名**；改名就是断链 |
| `_` 开头的目录/文件 | 工具自留地（草稿等），不参与构建 |
| 图片 | 同目录 `assets/`，用 `![说明](assets/x.png)` |

代码实现只有一处：`engine/core/content_paths.py`（发现 + 路径推算）。
构建（`engine/content/posts.py`）、CLI（`engine/cli.py`）、回归测试都调它。

## 内容放哪

| 你要加的东西 | 路径 |
|---|---|
| 文章 | `site/content/posts/<年份>/[系列/]<slug>/index.md`，图片在同目录 `assets/` |
| 文章英文版 | 同目录 `index.en.md` |
| 成员 | `site/content/members/<id>.sml` |
| 项目 | `site/content/projects/<slug>.sml` |
| 资源 | `site/content/resources/<slug>.sml` |
| 技术互助 | `site/content/services/<slug>.sml` |
| 独立页面 | `site/content/pages/*.md` 或 `*.sml` |
| 导航/群信息 | `site/content/site.sml` |
| 契约字段 | `site/content/contracts/blog.sml`（高影响，维护者改） |

## 文档放哪

| 类型 | 位置 |
|---|---|
| 给人看的指南 | `docs/` 根，登记到 `docs/README.md` |
| 已完成任务书/交接 | `docs/archive/<主题>/` |
| 归档代码（含其文档） | `archive/<主题>/`，入口 `README.md` |
| 站点上的制度页 | `site/content/pages/` |

## 不要入库

以下由构建或工具生成，已在 `.gitignore`：

- `dist/` 构建产物；
- `site/fonts/src/`、`site/fonts/subset/`；
- `archive/gui/rust/gen/`、Rust `target/`；
- `__pycache__/`；
- 本机令牌/密码（`site/fonts/FONT_PASSWORD.txt`、`.env` 等）。

## 根目录文件的含义

| 文件 | 作用 |
|---|---|
| `README.md` | 人类上手入口 |
| `CONTRIBUTING.md` | 根入口，指向 `docs/CONTRIBUTING.md` |
| `AGENTS.md` | AI/维护者的仓库索引与红线 |
| `Dockerfile` | 自托管镜像 |
| `LICENSE` / `LICENSE-CONTENT` | 代码/内容许可 |

## 新增文件前的三个问题

1. 它是给人看的，还是给机器/构建用的？
2. 它是一次性任务书，还是长期维护的文档？
3. 它应该跟内容走（`site/content`）、跟引擎走（`engine`）、还是跟人走（`docs`）？

答完再放，基本不会放错。
