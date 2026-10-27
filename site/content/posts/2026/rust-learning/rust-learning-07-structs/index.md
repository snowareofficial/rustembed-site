---
title: "1.6 结构"
author: cxi
date: 2026-10-20
tags: [ rust 类型 结构体 ]
summary: "具名结构体、元组结构体、空结构体、可见性与可变性。"
series:
  id: rust-learning
  title: "Rust 学习"
  order: 7
map: true
---

Rust 的 `struct` 是**聚合类型**——一种把若干数据字段捆绑在一起的容器。字段在内存中紧密排布，并在最严格字段对齐规则下整体对齐。

## 1.6.1 具名结构体（named-field struct）
```rust
#[derive(Debug,Default)]
struct ColorRGB{
    r:i32,
    g:i32,
    b:i32,
}

fn main()
{
    let origin = ColorRGB::default();
    let _point = ColorRGB{g:5,..ColorRGB::default()};
    let point = ColorRGB{g:100,..origin};
    let ColorRGB { r:r0, g:g0, .. } = point;

    println!("origin {:?} ",origin);
    println!(" point {:?} ",point);
    println!("{} {}",r0,g0);

    let init = ColorRGB{r:100,g:200,b:66};
    let ColorRGB { r:r0, g:g0, b:b0 } = init;
    println!("{} {} {}",r0,g0,b0);

    let ColorRGB { r, g, b } = init;
    println!("{} {} {}",r,g,b);
}
```

**已编译运行（取自 **`src/Chapter4/struct.rs`**）。**

```latex
origin ColorRGB { r: 0, g: 0, b: 0 } 
 point ColorRGB { r: 0, g: 100, b: 0 } 
0 100
100 200 66
100 200 66
```

字段更新语法 `..base` 要求 `base` 在该位置之后不再被使用（部分移动机制保护）。

## 1.6.2 元组类型结构体（tuple struct）
```rust
fn main() {
struct Kilograms(u32);
struct Pound(u32);
let w = Kilograms(250);
let Kilograms(kgm) = w; // 解构成局部变量 kgm: u32
}
```

常用于"newtype"模式：借类型系统在编译期防止 `Kilograms` 与 `Pound` 混算，比 `assert` 可靠百倍。

## 1.6.3 空结构体
```rust
fn main() {
struct Electron;     // unit-like struct，零大小类型 (ZST)
struct Proton;       // 占用 0 字节，常做"标记类型"使用
}
```

空 struct 没有字段，类型仍存在，`std::mem::size_of::<Electron>() == 0`，常做 trait 标记、状态标记。

## 1.6.4 结构可见性
默认 `private`（仅当前 module 可见）；加 `pub` 才能暴露给外部 module。

```rust
fn main() {
pub struct GrayscaleMap {
    pub pixels: Vec<u8>,         // 字段也单独控制 pub
    pub size: (usize, usize),
}
struct Struct1 {
    pub field1: i16,             // 字段 pub，struct 仍 private
    field2:  String,             // 完全 private
}
}
```

## 1.6.5 结构/字段的可变性
Rust 没有 C++ 那种"const 部分字段"：整个绑定可不可变由 `let mut` 决定，**字段本身永远是 immutable 标记**。

```rust
use std::fmt::Display;

// 默认是 不可见的 private
pub struct GrayscaleMap {
    pub pixels: Vec<u8>,
    pub size: (usize, usize),
}

struct Struct1 {
    pub field1: i16, // 外部可见
    field2: String,  // 外部不可见
}

struct Point {
    // 结构体具有可变性
    // mut x:i32, // 内部声明不能直接声明 为可变-mut
    x: i32,
    y: i32,
}

#[derive(Debug)]
struct S1{
    field1:i32,
    field2:S2
}

#[derive(Debug)]
struct S2{
    field:i32,
}

impl Display for S1 {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "S1(field1: {}, field2: S2(field: {}))", self.field1, self.field2.field)
    }
}

fn main() {
    let mut point = Point { x: 0, y: 0 };
    point.x = 100;
    (point.x,point.y) = (222,333);
    println!("{}",point.x);

    let s = S1{field1:45,field2:S2 { field: 666 }};
    let mut s = S1{field1:77,field2:S2 { field: 99 }};
    s.field1 = 666;
    s.field2.field = 288;
    println!("{:#?}",s);
    println!("{}",s);
}
```

**已编译运行（取自 **`src/Chapter4/结构可见性.rs`**）。**

```latex
222
S1 {
    field1: 666,
    field2: S2 {
        field: 288,
    },
}
S1(field1: 666, field2: S2(field: 288))
```

要让"外部看是只读、内部能改"某字段，需要：

+ `Cell<T>`：原地改 `T`（无论 Copy 与否）；
+ `RefCell<T>`：运行时借用计数；
+ `UnsafeCell<T>`：手动 unsafe。

```rust
use std::cell::Cell;

struct Struct1 {
    f: i32,
}

struct Struct2<'a> {
    f: &'a mut Struct1, // 可变的引用字段
}

struct Struct3<'a> {
    f: &'a Struct1, // 不可变的引用字段
}

// 如果需要字段 可变 使用 Cell
struct Point {
    x: i32,
    y: Cell<i32>,
}

fn main() {
    let mut s1 = Struct1 { f: 56 };
    let s2 = Struct2 { f: &mut s1 };
    s2.f.f = 666;

    let s1 = Struct1 { f: 200 };
    let mut s3 = Struct3 { f: &s1 };

    s3.f = &s1;
    println!("{}", s3.f.f);
    s3.f = &s2.f; // 地址传递
    println!("{}", s3.f.f);

    // s3.f.f = 100; // 错误不可修改
    s3.f = &Struct1 { f: 777 }; // 可以修改 结构体的“对象“
    println!("{}", s3.f.f);

    let init = Point {
        x: 2,
        y: Cell::new(55),
    };
    println!("{}", init.y.get());
    init.y.set(66);
    println!("{}", init.y.get());
    init.y.set(88);
    println!("{}", init.y.get());
}
```

**已编译运行（取自 **`src/Chapter4/结构体中使用引用.rs`**）。**

```latex
200
666
777
55
66
88
```

## 1.6.6 其他
+ **内存布局**：`#[repr(Rust)]`（默认）允许编译器重排、对齐、补白；`#[repr(C)]` 锁定 C-ABI 与 C 互操作；`#[repr(transparent)]` 保证"只有一个非零字段，与该字段完全等价"。
+ **字段重排限制**：仅在不破坏 ABI 的前提下编译器可重排，但 `#[repr(C)]` 下严格遵守声明顺序。
+ **const 字段**：`impl Coord { const ZERO: Coord = Coord { x: 0.0, y: 0.0 }; }` 写法见 `变量.rs`。
