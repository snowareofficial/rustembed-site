# 仓库目录地图

先看这张表，再决定文件放哪。不要往根目录堆临时文件。

```text
rec-blog/
├─ site/                  站点本身（换站点只换这个目录）
│  ├─ content/            内容：文章、成员、项目、资源、互助、页面、契约
│  ├─ theme/              前端壳：index.html + css/ + js/（加载顺序以 index.html 为准）
│  ├─ fonts/              字体加密包、许可、子集输出（src/、subset/ 不入库）
│  └─ meta/               仓库元数据缓存
├─ engine/                构建引擎（与具体内容无关，可复用）
│  ├─ build.py check.py preview.py cli.py config.py
│  ├─ lib/                sml / markdown / render / contract / mathml / urls ...
│  ├─ native/             sml.dll（gitignore；缺失自动回退）
│  ├─ vendor/             fontTools / latex2mathml（vendored）
│  └─ test_*.py           契约、渲染安全、结构断言
├─ gui/                   写作台：Rust 启动器 + 内嵌 Web UI + Tauri
├─ templates/             给作者的复制模板（post / resource / project / member / service）
├─ tests/                 前端/接口验收（smoke、browser-check、gui_dom、gui_api）
├─ deploy/                自托管：Docker entrypoint / build / fonts-crypt / webhook
├─ docs/                  设计与流程文档（见 docs/README.md）
│  └─ archive/            已完成的任务书/交接，不再维护
├─ .github/               CI：build / publish-pages / sync-code / sync-from-gitee
├─ .gitee/                Gitee 的 PR/Issue 模板
├─ Cargo.toml / Cargo.lock
├─ Dockerfile / .dockerignore
├─ README.md              上手入口
├─ CONTRIBUTING.md        根入口：指向 docs/CONTRIBUTING.md
├─ AGENTS.md              仓库级 AI/维护者索引
└─ LICENSE / LICENSE-CONTENT
```

## 内容放哪

| 你要加的东西 | 路径 |
|---|---|
| 文章 | `site/content/posts/<年份>/<slug>/index.md`，图片在同目录 `assets/` |
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
| GUI 视觉稿 | `docs/gui-mock/` |
| 站点上的制度页 | `site/content/pages/` |

## 不要入库

以下由构建或工具生成，已在 `.gitignore`：

- `dist/` 构建产物；
- `site/fonts/src/`、`site/fonts/subset/`；
- `gui/gen/`、Rust `target/`；
- `__pycache__/`；
- 本机令牌/密码（`site/fonts/FONT_PASSWORD.txt`、`.env` 等）。

## 根目录文件的含义

| 文件 | 作用 |
|---|---|
| `README.md` | 人类上手入口 |
| `CONTRIBUTING.md` | 根入口，指向 `docs/CONTRIBUTING.md` |
| `AGENTS.md` | AI/维护者的仓库索引与红线 |
| `Cargo.toml` | Rust workspace（GUI） |
| `Dockerfile` | 自托管镜像 |
| `LICENSE` / `LICENSE-CONTENT` | 代码/内容许可 |

## 新增文件前的三个问题

1. 它是给人看的，还是给机器/构建用的？
2. 它是一次性任务书，还是长期维护的文档？
3. 它应该跟内容走（`site/content`）、跟引擎走（`engine`）、还是跟人走（`docs`）？

答完再放，基本不会放错。
