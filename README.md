# rec-blog · Rust嵌入式探讨

QQ 群「Rust嵌入式探讨」的共建博客。**内容写 Markdown（默认）或 SML**，构建期预渲染成静态页面，
托管在 Cloudflare Pages：`rec-blog.swebase.cn`（主）、`rust-embed.swebase.cn`（别名）。

## 五分钟上手

```bash
python engine/cli.py new "文章标题" --tags rust,embedded   # 生成文章骨架
python engine/cli.py list --tag rust                       # 列文章
python engine/cli.py contracts                             # 终端里看契约字段表
python engine/cli.py build                                 # 构建（含契约校验）
python engine/cli.py test                                  # 契约自测
python engine/cli.py check                                 # 产物自检
python engine/cli.py preview                               # 构建 + 预览 http://127.0.0.1:8080/
```

投稿三步：fork → 在 `site/content/posts/<年份>/<英文短名>/index.md` 写文章 → 提 PR。
不方便用 git 的，把稿子交给有仓库权限的群管理代投（署名仍是作者本人）。
**完整文件结构、git 写作流程、全链路验证见 [`docs/WORKFLOW.md`](docs/WORKFLOW.md)。**

## 目录结构

```
engine/                   工具体系（与本站内容无关，可整体复制给别的站点复用）
├─ build.py check.py preview.py cli.py test_contracts.py config.py
├─ lib/                   sml / markdown / render / contract / mindmap / repo_meta / summary
├─ prompts/summarize.md   AI 摘要的输入输出约定（构建期用，离线）
└─ vendor/fontTools/      vendored fontTools（字体子集化，不是 pip 依赖）
                         详见 engine/README.md（每个文件职责 + 常见改动怎么做）

site/                     本站点本身
├─ content/               内容：改这里就够了
│  ├─ site.sml            站点配置（站名、导航、公告、群信息、群规、大事记）
│  ├─ posts/<年>/<短名>/   文章：index.md 或 index.sml，图片放同目录 assets/
│  ├─ pages/*.sml         站文档（投稿指南、写作速查、附件规则、创作制度、加入我们）
│  ├─ topics/*.(md|sml)   主题词条（同标签文章自动归入）
│  ├─ members/<id>.sml    成员档案（自愿制；同目录放 <id>.jpg 即自动作为头像）
│  ├─ projects/<id>.sml   项目（仓库元数据构建期自动抓取）
│  ├─ resources/<id>.sml  资源库
│  ├─ weekly/<期>.sml     周报 / 月刊
│  ├─ summaries/<slug>.json  可选：AI 摘要产物（没有则用构建期抽取式摘要）
│  └─ contracts/*.sml     内容契约（字段即文档）
├─ theme/                 前端壳（index.html / app.js / style.css）
│  └─ fonts/             可选：自托管字体（如 MiSans-*.ttf，构建期子集化，见 docs/FONTS.md）
├─ meta/repos.json        仓库元数据缓存
└─ *.jpg                  群 logo（同时作为站点 favicon）

docs/                     开发者文档（架构、部署、字体、治理、路线图、工作流）
dist/                     构建产物（gitignore）
```

## 两种写作格式

| | Markdown（默认） | SML（可选） |
|---|---|---|
| 文件 | `index.md` | `index.sml` |
| 适合 | 所有人，日常写文章 | 需要严格字段校验、定理/证明、片段复用 |
| 元数据 | front matter（YAML 子集） | 顶层字段 |
| 渲染结果 | 与 SML **完全一致**（同一套 HTML/CSS/章节树/导图/搜索索引） | 同左 |

速查：`site/content/pages/write-markdown.sml`、`site/content/pages/write-sml.sml`（页面内在站点上是「文档 → 写作」）。

## 制度与规范（都在站点「站文档」栏，Markdown 写的）

| 制度 | 说明 |
|---|---|
| 角色与权限 | 三层权限互不相干（QQ 群 ≠ 仓库 ≠ 发布）；谁能改什么、写权限怎么拿、怎么回收 |
| 仓库与分支 | 只有 `master`，所有改动走 PR；提交信息、PR 要求、命名与放置约定、密钥纪律 |
| 创作与审稿 | 投稿流程与 3 日 SLA、审稿标准、署名与许可、退稿与纠错、内容边界 |
| 下架与申诉 | 可先行下架的情形、作者主动下架、申诉时限与留档 |
| 附件规则 | 图片入库（2 MB / 20 张）、其余外链、审核项 |
| 隐私与数据 | 不接统计与广告、无 Cookie 追踪、成员联系方式授权、安全报告流程 |

面向管理者：`docs/GOVERNANCE.md`（制度索引 + 权限矩阵 + 制度修改程序 + 定期复核）；
面向投稿者：`CONTRIBUTING.md`（5 分钟上手 + 自检命令 + 三条硬规矩）。

## 内容契约（字段即文档）

`site/content/contracts/blog.sml` 定义各类型的字段、类型、必填与约束（字段行 `#` 后是说明）。
`site/content/site.sml` 的 `contracts { }` 把它们按内容类型设为默认，写文件时也可用 `@is 契约名` 显式指定。

- 校验失败报错**错误码 + 人话**：`[E-CONTRACT-003] 契约 BlogPost 缺少必填字段 summary（字符串）`
- 站点上「**文档 → 规范 → 内容契约**」页由契约自动生成 —— 改契约 = 改校验 = 改文档
- 临时放宽：`python engine/build.py --contract-loose`（只放宽「未声明字段」）

## 部署

Gitee 是权威源：<https://gitee.com/rustembed/site>（地址的唯一数据源是 `site/content/site.sml` 的 `repo_url`）；
第二个源 <https://gitee.com/snoware/sml-sitegen> 是同一份代码，作为 SML 的应用示例对外展示（`repo_mirror`）：

```bash
git push origin master     # 权威源（必做）
git push sitegen master    # 示例源（可选，推同一个提交）
```

`.github/workflows/sync-from-gitee.yml` 每 6 小时把它单向镜像到 GitHub；
`publish-pages.yml` 定时构建并把静态产物强推到 **`pages` 分支**，Cloudflare Pages 直接取那个分支发布（不需要 CF token）。
`build.yml` 只做 PR/推送校验。
需要的 secret：`GITEE_USER` / `GITEE_TOKEN`（只读即可）、`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`；字体用 `FONT_PASSWORD` 解密加密包，AI 摘要用 `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`（都可选，缺了自动降级）。

也可以不用 Actions：**自建服务器（Docker 容器构建 + GLM 生成构建期摘要 + 发布）** 见 [`docs/SELF-HOST.md`](docs/SELF-HOST.md)，一条 Gitee Webhook 触发全链路。

## 许可

文章默认 `CC BY-NC-SA 4.0`（可在文章里用 `license` 覆盖），站点代码 MulanPSL-2。
成员页展示的联系方式均为本人自愿提供并授权展示。
