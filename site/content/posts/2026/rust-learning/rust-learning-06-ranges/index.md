---
title: "1.5 范围类型"
author: cxi
date: 2026-10-20
tags: [ rust 类型 ]
summary: "Range 系列的写法，以及在循环和切片中的用法。"
series:
  id: rust-learning
  title: "Rust 学习"
  order: 6
---

范围（`Range`）是迭代器 `Iterator` 的迷你版，可以和 `for`、`take`、`sum` 配合使用。

| 写法 | 类型 | 含义 |
| --- | --- | --- |
| `a..b` | `Range<T>` | 半开 `[a, b)` |
| `a..=b` | `RangeInclusive<T>` | 闭 `[a, b]` |
| `a..` | `RangeFrom<T>` | 自 `a` 开始，无终 |
| `..b` | `RangeTo<T>` | 无起，到 `b` 止 |
| `..=b` | `RangeToInclusive<T>` | 无起，到 `b` 闭止 |
| `..` | `RangeFull` | 全域 |


```rust
fn main() {
assert_eq!(3 + 4 + 5, (3..6).sum());      // 迭代求和
for i in 10..15 { println!("{} ", i); }    // 半开
for i in 4.. {                              // 无限上界，要在循环里 break
    if i * 10 > 100 { break; }
}
let r: std::ops::RangeFull = ..;           // 全域 range 是零大小类型
}
```

**已编译运行。**

```latex
10 
11 
12 
13 
14 
```

范围不是"长度"而是一对端点，因此 `Range<i32>` 的大小等于 `2*size_of::<i32>() = 8`；`RangeFull` 是空结构体 ZST，大小 0——不会随端点变胖。
