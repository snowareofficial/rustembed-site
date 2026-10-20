---
title: "1.13 注释"
author: cxi
date: 2026-10-20
tags: [ rust 基础 ]
summary: "行注释、块注释与文档注释。"
series:
  id: rust-learning
  title: "Rust 学习"
  order: 14
---

```rust
/// 把字节切片转成十六进制字符串（演示 ///）。
pub fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02X}", b)).collect()
}

fn main() {
    // 行注释
    let x = 5;  // 行尾注释
    /* 块注释
       多行也行 */
    let s = String::from("hi");
    println!("{} {}", x, s);
    println!("{}", to_hex(&[0xAB, 0xCD]));
    println!("{}", to_hex(b"hi"));
}
```

**（教学片段，直接复制 src/Chapter4/ 对应文件即可运行。）**

`///` 与 `//!` 的本质差别是作用对象：

| 注释 | 写在 | rustdoc 生成 |
| --- | --- | --- |
| `///` | 项（fn / struct / trait 等）之上 | 该项的"详情页" |
| `//!` | 模块或 crate 的最顶（紧跟 `{` 之前） | 模块首页 |


doc 注释支持 Markdown；常见的代码示例围栏用 ` ```rust `，会被 rustdoc 视为可执行示例：

```markdown
/// 把一组字节以十六进制形式拼接成字符串。
///
/// # 示例
///
/// ```
/// use my_crate::to_hex;
/// assert_eq!(to_hex(&[0xAB, 0xCD]), "ABCD".to_string());
/// ```
pub fn to_hex(bytes: &[u8]) -> String { /* ... */ }
```

推荐：

1. 公开 API 的 `///` 文档应当包含示例（rustdoc 会运行示例）。
2. `// TODO(...)` 与 `// FIXME(...)` 方便 IDE 与 git 检索。
3. 复杂算法或反直觉的代码上方放 2–3 行块注释解释"为什么"，比"是什么"对读者更有价值。
