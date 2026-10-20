---
title: "1.4 元组"
author: cxi
date: 2026-10-20
tags: [ rust 类型 ]
summary: "元组的声明、解构、索引与常见使用方式。"
series:
  id: rust-learning
  title: "Rust 学习"
  order: 5
---

元组（tuple）是**长度固定、各元素类型可异**的复合类型：`(i32, f64, bool)` 是一个类型。

## 1.4.1 元组声明
```rust
fn main() {
let tup: (i32, f64, char, bool) = (500, 6.4, 'a', true);
let tuple = (1.0, "milly", true, 200); // 推导型
}
```

## 1.4.2 元组解构
```rust
fn main() {
    let (a, b) = (20, "test");
    println!("{} - {}", a, b);
    let _tuple_of_tuples = ((3u8, 5u16, 12u8), -5i16, (14u64, -6i8)); // 嵌套元组

    let tuple = (1.0, "milly", true, 200);
    let (_a, _b, _c, _d) = tuple;

    let tup = (1, 2.0, 3);
    let (_x, y, _z) = tup;
    println!("y = {}", y);

    let text = "I see her eye sparkling";
    let (first, second) = text.split_at(6); // 切割
    println!("{} \r\n {}", first, second);

    let big_tuple = (10u8, 20u8);
    println!("{}  {}", big_tuple.0, big_tuple.1);

    let (p2, p3) = pow23(3);
    println!("{} {}", p2, p3);
    println!("{:?}", tup);
    println!("{:#?}", tup);

    println!("单元素元组:{:?}", (10u32,));
    println!("单元素整数:{:?}", (10u32));
}

fn pow23(n: i32) -> (i32, i32) {
    (n * n, n.pow(3))
}
```

**已编译运行（取自 **`src/Chapter4/tupledestruc.rs`**）。**

```latex
20 - test
y = 2
I see  
 her eye sparkling
10  20
9 27
......
    1,
    2.0,
    3,
)
单元素元组:(10,)
单元素整数:10
```

## 1.4.3 元组索引
```rust
fn main() {
let big_tuple = (10u8, 20u8);
println!("{}  {}", big_tuple.0, big_tuple.1); // 下标常量访问
}
```

**已编译运行。**

```latex
10  20
```

## 1.4.4 元组使用
```rust
fn main() {
let (p2, p3) = pow23(3); // 函数返回元组
println!("{} {}", p2, p3);
fn pow23(n: i32) -> (i32, i32) { (n * n, n.pow(3)) }
}
```

**已编译运行。**

```latex
9 27
```

`{:?}` 与 `{:#?}` 是 `Debug` 格式：`#` 多一行一个元素，方便打印嵌套元组。

## 1.4.5 特殊情况
+ **单元素元组**必须有逗号：`(10u32,)`。
+ **嵌套**任意：`((3u8, 5u16, 12u8), -5i16, (14u64, -6i8))`。
+ **空元组** `()` 是 unit 类型，所有无返回值语句都返回它。
