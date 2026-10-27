---
title: "投稿其实很简单：写 Markdown 就行"
author: sal
date: 2026-09-20
tags: [ 指南 markdown 投稿 ]
summary: "不用学 SML。文章用 Markdown 写，front matter 填几个字段，提 PR 即可；SML 只是给需要更强结构的人准备的。"
series:
  id: rust-embedded-101
  title: Rust 嵌入式入门
  order: 2
license: "CC BY-NC-SA 4.0"
map: true
---

## 为什么不用逼你学 SML

站点底层是 SML，但**投稿不要求写 SML**：`posts/<年份>/<短名>/index.md` 走 Markdown，
`index.sml` 走 SML，两者渲染出来的样式、章节树、搜索索引完全一样。

需要 SML 的场景只有两种：想要**严格契约校验**（`@contract` 钉字段类型），或者要写**定理/证明**这类结构化内容。

## 文件长什么样

目录结构就两个文件的事：

```
posts/2026/md-writing/
├─ index.md          ← 正文 + front matter
└─ assets/           ← 图片放这里（可不存在）
```

front matter 只要 5 个必填字段：

| 字段 | 说明 |
|---|---|
| title | 标题 |
| author | 成员 id（对应 `members/<id>.sml`，没有档案也能发，只是不会链接到个人页）|
| date | 发布日期 `YYYY-MM-DD` |
| tags | 标签数组，如 `[ rust embedded ]` |
| summary | 一两句摘要，列表页与分享卡片用 |

## 正文能写什么

标题、段落、**粗体**、*斜体*、~~删除线~~、`行内代码`、[链接](https://rec-blog.swebase.cn)、
列表、表格、引用、围栏代码块、图片，都支持。

```rust
#[entry]
fn main() -> ! {
    let dp = pac::Peripherals::take().unwrap();
    loop { cortex_m::asm::wfi(); }
}
```

> 引用也可以嵌套列表和代码。

单独一行放 B 站视频号就会自动嵌入：

BV1GJ411x7h7

图片放同目录 `assets/`，正文里写相对路径 `![说明](assets/xxx.png)`，可加 `"图注"`：

```
![接线图](assets/wiring.png "USART1 接线")
```

构建会检查这类本地图片是否真的存在，路径写错会直接报错。

## 附件

图片入库；PDF / 压缩包 / 固件一律走外链，写在 front matter 里：

```yaml
attachments:
  - name: 示例工程
    kind: link
    url: https://gitee.com/rustembed/site
    size: 1.2 MB
```

## 最后

提 PR，或者把稿子丢给有仓库权限的群管理代投。格式问题构建脚本会直接报出来，不用你自己猜。
