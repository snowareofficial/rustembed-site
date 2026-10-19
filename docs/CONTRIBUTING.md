# 写作与投稿

这份文档是给**要写内容的人**看的，不是给维护引擎的人看的。你不需要先懂 SML、契约或构建系统。

## 先选一条路

| 你想做的事 | 用什么 | 需要会 git 吗 |
|---|---|---|
| 写一篇文章 | Markdown（`index.md`） | 最好会；不会可以走路线 C |
| 加一个资源 / 项目 / 成员 / 互助条目 | SML（`*.sml`，只是字段列表） | 最好会；不会可以走路线 C |
| 完全不想碰仓库 | 把稿子发给群管理 | 不需要 |

---

## 路线 A：写一篇文章（推荐）

文章用 **Markdown**，和 Obsidian、Typora、VS Code 里写普通笔记一样。

### 1. 建目录

```text
site/content/posts/<年份>/<英文短名>/index.md
```

例如：

```text
site/content/posts/2026/board-bringup/index.md
```

英文短名只用于 URL，建议小写、连字符。

### 2. 写 front matter

文件最上面：

```markdown
---
title: "从零点亮一块板子"
author: sal
date: YYYY-MM-DD
tags: [ rust, embedded, cortex-m ]
summary: "用 probe-rs 和一块最小板，走一遍上电、下载、串口输出。"
---

## 第一个小节

正文……
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `title` | 是 | 文章标题 |
| `author` | 是 | 成员 id，对应 `site/content/members/<id>.sml`；没有档案也能发，只是不链接个人页 |
| `date` | 是 | `YYYY-MM-DD` |
| `tags` | 是 | 标签数组，例如 `[ rust, embedded ]` |
| `summary` | 是 | 一两句摘要，列表和搜索结果会显示 |
| `map` | 否 | `true` 生成章节导图 |
| `series` | 否 | `{ id, title, order }`，系列文章 |
| `video` | 否 | B 站 BV 号或视频链接 |
| `attachments` | 否 | 附件数组，字段见契约 |

### 3. 写正文

常用写法：

| 写法 | 效果 |
|---|---|
| `## 标题` | 小节，会进左侧目录 |
| `**粗体**` / `*斜体*` / `` `代码` `` | 行内样式 |
| `![说明](assets/x.png)` | 图片，图片放同目录 `assets/` |
| `[文字](https://…)` | 链接 |
| `> 引用` | 引用块 |
| `- 列表` / `1. 列表` | 列表 |
| `\| a \| b \|` | 表格 |
| `$x^2$` / `$$\frac{a}{b}$$` | 数学公式 |
| `:::note` … `:::` | 提示块，另有 `tip/warn/panel/steps/gallery` |

更完整的正文语法见站内「Markdown 写作速查」页。

### 4. 本地预览（可选）

需要 Python 3.8+，不需要 `pip install`：

```bash
python engine/cli.py preview
# 打开 http://127.0.0.1:8080/
```

只构建不预览：

```bash
python engine/cli.py build --offline
python engine/cli.py check
```

### 5. 提 PR

- 目标分支是 **`staging`**，不是 `master`；
- PR 合入 `staging` 后会自动生成预览；
- 维护者验收后再 `staging → master` 发布生产。

不会 git 就看路线 C。

---

## 路线 B：加资源 / 项目 / 成员 / 互助

文章之外的结构化条目用 **SML**。SML 不是编程语言，本质是：

```text
字段: 值
```

引擎会按文件所在目录套用契约（字段表），你只要照模板填。

### Resource（资源）

文件：`site/content/resources/<英文短名>.sml`

```sml
title: "The Embedded Rust Book"
kind: book
url: "https://docs.rust-embedded.org/book/"
tags: [ rust embedded book ]
note: "官方入门书，no_std 与外设访问的基础概念都在这里。"
```

`kind` 只能是：`book / tutorial / tool / video / course / route`。

### Project（项目）

文件：`site/content/projects/<英文短名>.sml`

```sml
name: "rec-blog"
one_liner: "群共建的静态博客与写作工具链。"
repo: "https://gitee.com/rustembed/site"
status: active
```

### Member（成员）

文件：`site/content/members/<id>.sml`

```sml
name: "sal"
role: "发起人"
signature: "Rust / 嵌入式 / 工具链。"
links: { github: "https://github.com/…" }
```

### Service（技术互助）

文件：`site/content/services/<英文短名>.sml`

```sml
name: "PCB 布局与 EMC 走线复查"
owner: sal
skills: [ pcb, emc ]
wants: [ 小批量硬件一起做 ]
contact: [ github ]
rate: "远程评审；需要寄样板时走快递；时间与方式私聊，不谈价格"
status: active
updated: YYYY-MM-DD
```

> 模板不写 `@is`：引擎会按文件所在目录自动套契约。当前 SML 扩展对跨文件的 `@is` 会误报「未定义契约」，所以投稿文件里先不写；字段表用 `engine/cli.py contracts` 查。

字段表可以在终端看：

```bash
python engine/cli.py contracts
```

网页版：站内 **文档 → 规范 → 内容契约**（`#/page/contracts`），由 `site/content/contracts/blog.sml` 自动生成。

---

## 路线 C：完全不想碰 git

可以这样：

1. 按路线 A/B 写好 Markdown / SML 文件；
2. 把文件和图片打包，发到群里，说明“作者署名用哪个 id”；
3. 有仓库权限的管理员代投，PR 里注明原作者；
4. 预览链接发回给你确认。

不需要你注册 Gitee、不需要你配 SSH。

---

## 写作规则（少量硬要求）

- 不写 HTML/JS 进正文；需要交互就提需求，不要直接塞脚本；
- 图片放文章同目录的 `assets/`，不要用外部图床（构建会检查）；
- 附件类型和体积有限制，构建会报错；
- 不直接推 `master`；内容 PR 一律以 `staging` 为目标；
- 文章里的外部链接会过 URL 白名单，`javascript:` / `data:` 会被拒绝；
- 公式是构建期转 MathML，支持常用 LaTeX 子集；`\textcircled`、`\displaylimits` 等已做兼容，遇到不支持的命令构建会留下明显痕迹。

---

## 文档地图

| 文档 | 给谁看 |
|---|---|
| 本文 | 第一次写内容的人 |
| [`WORKFLOW.md`](WORKFLOW.md) | 想知道完整 git / 分支 / 发布流程的人 |
| [`FONTS.md`](FONTS.md) | 维护字体子集的人 |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | 维护引擎的人 |
| [`../AGENTS.md`](../AGENTS.md) | 接手的 AI/维护者 |

还有问题，直接在群里问；不要因为“怕写错格式”而不写。
