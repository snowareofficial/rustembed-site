# 改站点数据

面向：成员、项目、资源、互助、页面、导航的维护者。  
不涉及引擎代码；改完跑构建和自检即可。

## 数据在哪

```text
site/content/
├─ site.sml            站点标题、域名、导航、群信息、默认契约、审核人
├─ contracts/blog.sml  契约定义（字段表；一般不要动）
├─ members/            成员：<id>.sml
├─ projects/           项目：<英文短名>.sml
├─ resources/          资源：<英文短名>.sml
├─ services/           技术互助：<英文短名>.sml
├─ topics/             专题
├─ weekly/             周报 / 月刊
├─ pages/              独立页面（Markdown 或 SML）
└─ posts/              文章
```

文件名就是 URL 的一部分，**不要随意改已有文件的名字**，否则旧链接会失效。

## 通用规则

- UTF-8 无 BOM、LF、末尾换行；
- 字段用 `字段: 值`，字符串建议加引号；
- 目录决定默认契约：`resources/` 自动套 `Resource`，`projects/` 套 `Project`，依此类推；**不需要写 `@is`**；
- 改完必须跑：

```bash
python engine/cli.py build --offline
python engine/cli.py check
```

字段表：

```bash
python engine/cli.py contracts
```

构建报错会带错误码和字段名，例如：

```text
[E-CONTRACT-003] 契约 `Service` 缺少必填字段 `contact`（数组）
```

## 成员 `members/<id>.sml`

```sml
name: "sal"
role: "发起人"
signature: "Rust / 嵌入式 / 工具链。"
skills: [ rust, embedded ]
joined: YYYY-MM-DD
links: { github: "https://github.com/…" }
```

- `name` 必填，其余可选；
- `id` 是文件名，文章 `author`、服务 `owner` 都引用它；
- `links` 里的联系方式要本人同意才公开；不想公开就删掉。

## 项目 `projects/<英文短名>.sml`

```sml
name: "rec-blog"
one_liner: "群共建的静态博客与写作工具链。"
repo: "https://gitee.com/rustembed/site"
status: active
```

- `repo` 必填，构建期可能抓元数据；
- `status`：`active / archived / wip`；
- 不要写 `tags`：Project 契约没有这个字段。

## 资源 `resources/<英文短名>.sml`

```sml
title: "The Embedded Rust Book"
kind: book
url: "https://docs.rust-embedded.org/book/"
tags: [ rust embedded book ]
note: "官方入门书，no_std 与外设访问的基础概念都在这里。"
```

- `kind` 只能是 `book / tutorial / tool / video / course / route`；
- `url` 必须是 http(s)，不能是 `javascript:` / `data:`。

## 技术互助 `services/<英文短名>.sml`

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

- `owner` 必须是 `members/` 里存在的 id；
- `contact` 只能引用 owner 已公开的 links 键；
- `status`：`active / paused`；
- 只做信息展示：不报价、不抽成、不担保、不经手资金。

## 页面 `pages/`

两种格式：

### Markdown 页面

```markdown
---
title: "隐私与数据"
group: 关于
order: 2
---

正文……
```

适合纯文章型页面。

### SML 页面

适合需要结构化块（topic、steps、table）的页面，例如 `write-markdown.sml`：

```sml
title: "Markdown 写作速查"
group: 写作
order: 1

body: [
  topic 最小模板 {
    children: [
      para { text: "……" }
    ]
  }
]
```

## 导航与站点级信息 `site.sml`

`site.sml` 是站点唯一配置源，常见字段：

| 字段 | 作用 |
|---|---|
| `title` / `tagline` | 站点标题、副标题 |
| `url` / `domains` | 主域名、别名 |
| `repo_url` / `repo_mirror` | 仓库地址（内容里引用同一份） |
| `default_license` | 默认许可 |
| `announcement` | 首页公告 |
| `nav` | 导航顺序 |
| `reviewers` | PR 默认审核人 |
| `contracts { … }` | 目录 → 契约的默认映射 |
| `group { … }` | 群信息、规则、时间线 |

**不要改 `contracts` 映射**，除非你同时改了契约和构建代码。

## 常见错误

| 现象 | 原因 |
|---|---|
| `未定义的契约` | 文件放错目录，或改了 `contracts` 映射 |
| `缺少必填字段` | 对照 `engine/cli.py contracts` 补字段 |
| `未声明字段` | 契约是严格模式；删掉多余字段，或确认应放 `loose` 块 |
| 图片 404 | 图片没放在文章同目录 `assets/` |
| 链接被拒 | URL 不是 http(s)，或不在白名单 |
| 页面没更新 | 没重新 build，或看的是旧缓存 |

## 改完的提交

```bash
git add site/content/...
git commit -m "content(members): 更新成员资料"
```

PR 目标分支：`staging`。不要直接推 `master`。

## 相关

- 审稿：[`REVIEW.md`](REVIEW.md)
- 运维/发布：[`OPS.md`](OPS.md)
- 写作：[`CONTRIBUTING.md`](CONTRIBUTING.md)
