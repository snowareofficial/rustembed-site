# 参与这份博客

面向群友与管理员的最小说明。**完整制度在站点上**，仓库里这份只是入口。
**文件结构、git 写作流程、全链路验证见 [`docs/WORKFLOW.md`](docs/WORKFLOW.md)。**

## 我是群友，想投一篇

1. fork 仓库，新建 `site/content/posts/<年份>/<英文短名>/index.md`；
2. 顶部填 front matter：

```markdown
---
title: "文章标题"
author: 你的成员id
date: 2026-09-20
tags: [ rust embedded ]
summary: "一两句摘要"
---
```

3. 正文用 Markdown 写（标题、列表、代码块、表格、图片都支持；单独一行放 B 站 BV 号会显示可点击的视频卡）。
   想要「章节导图」就在 front matter 加 `map: true`（默认关闭；开启后弹层里可拖动/缩放）；
4. 本地自检：

```bash
python engine/cli.py test      # 契约自测
python engine/cli.py build     # 构建（会校验字段与附件）
python engine/cli.py check     # 产物自检
python engine/cli.py preview   # 本地预览 http://127.0.0.1:8080/
```

5. 提 PR。不想用 git：把稿子发给任意管理员代投，署名仍是你的。

## 我是管理员

- 合并前看：事实是否成立、字段是否齐、附件是否合规（见站点「制度」栏）；
- 制度改动单开 PR，并在描述里写明「改了哪条、为什么」；
- 改契约（`site/content/contracts/`）与引擎（`engine/`）属于高影响改动，需两名以上管理员同意；
- 发布与回滚见 `docs/DEPLOY.md`。

## 制度文档在哪

| 内容 | 位置 |
|---|---|
| 角色与权限、仓库与分支、创作与审稿、下架与申诉 | 站点「站文档 → 制度」 |
| 附件规则、写作速查 | 站点「站文档 → 规范 / 写作」 |
| 隐私与数据、加入我们 | 站点「站文档 → 关于」 |
| 制度总览与索引 | `docs/GOVERNANCE.md` |

## 三条硬规矩

1. 不直接推 `master`（除错别字、坏链、紧急下架）；
2. 密钥不进仓库、不进群聊、不贴截图；
3. 引用他人内容必须标出处并确认许可。
