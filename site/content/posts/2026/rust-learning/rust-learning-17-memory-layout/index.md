---
title: "1.16 程序的内存表现"
author: cxi
date: 2026-10-20
tags: [ rust 内存 ]
summary: "程序运行时的内存布局。"
series:
  id: rust-learning
  title: "Rust 学习"
  order: 17
---

Rust 默认把所有可确定大小的数据放在栈上，把需要动态分配或可能收缩增长的数据交给堆。这一节与 1.1 节呼应，给一些落地观察：

| 数据 | 在哪分配 |
| --- | --- |
| `i32`、`bool`、`char`、结构体局部变量 | 栈 |
| `[T; N]` 数组 | 栈 |
| `&T` / `&mut T` / `&str` / `&[T]` | 胖指针在栈，指向处可能是堆、栈、常量段 |
| `Box<T>` | 胖指针在栈，指向堆 |
| `Vec<T>`、`String`、`HashMap` | 堆（数据），栈（胖指针） |
| `static` / `static mut` | 静态段（`.bss` / `.data`），整程序生命周期 |
| `const` | 由编译器内联到使用点，无独立地址 |
| 闭包 | 默认栈；`move` 闭包可能含 `Box` 堆 |


`std::mem::size_of::<T>()` 给出 T 在栈上"胖指针大小"或"对象大小"。可以用它在调试时核对尺寸假设。
