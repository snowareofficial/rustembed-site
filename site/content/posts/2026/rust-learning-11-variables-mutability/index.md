---
title: "1.10 变量和可变性"
author: cxi
date: 2026-10-20
tags: [ rust 基础 ]
summary: "变量绑定、可变性、作用域与遮蔽、常量/静态、类型转换和零长度类型。"
series:
  id: rust-learning
  title: "Rust 学习"
  order: 11
map: true
---

## 1.10.1 变量绑定
Rust 用 `let` 把名字绑到值上，**默认不可变**：

```rust
fn main() {
let x = 5;          // 不可变
let mut y = 5;      // 可变
y = 6;              // OK
// x = 6;           // 报错：x 不可变
}
```

Rust 没有 C 那种"未初始化陷阱"：声明即绑定，要么立刻赋值，要么声明时标注永不读直到赋值。

## 1.10.2 变量
```rust
fn main() {
let number;                 // 延后绑定
number = 1;                 // 必须赋值才能读
// let number = 3;          // 报错：number 是不可变绑定，只能赋值一次
}
```

## 1.10.3 可变性
`mut` 决定**绑定本身**是否可变；不是"可变数据与不可变数据"的差别。要在函数内修改入参则用 `&mut` 借用：

```rust
fn main() {
fn add_one(mut n: i32) -> i32 { n += 1; n }
}
```

## 1.10.4 变量的作用域和遮蔽
```rust
fn main() {
let x = 2;
{
    let x = 3;              // 内部遮蔽外部 x
    println!("{x}");        // 3
}
println!("{x}");            // 2
}
```

**已编译运行。**

```latex
3
2
```

遮蔽与可变绑定是两件不同的事：

+ 遮蔽：重新 `let`，**可换类型**、可换值。
+ `mut`：同一绑定继续用，必须同类型。

```rust
fn main() {
let s = "  5  ";
let s = s.trim();           // 遮蔽成 &str
let n: u32 = s.parse().unwrap(); // 再遮蔽成 u32
}
```

## 1.10.5 常量和静态全局变量
```rust
fn main() {
const MAX_LENGTH: i32         = 10;                  // 编译期常量，可内联
static COMPANY_NAME: &str     = "我是球长";          // 静态：有固定地址
static mut MEEP: u32          = 666;                 // 读写必须 unsafe
}
```

| 维度 | `const` | `static` |
| --- | --- | --- |
| 地址 | 无固定地址 | 有固定地址（`&MY_STATIC` 可取） |
| 初始化 | 必须 `const fn` 可求值 | 普通 `fn`（运行时一次性初始化） |
| 可变性 | 不可变 | `static mut`（unsafe） |
| 内联 | 会被内联到使用点 | 不会内联 |


> **延迟初始化**：需要运行时计算的全局初始值，不能直接 `static x: T = foo();`。  
现代三方案：
>
> 1. `std::sync::LazyLock<T>`（1.80+ 标准库，**推荐**）。
> 2. `once_cell::sync::OnceCell<T>` / `Lazy`。
> 3. `lazy_static!` 宏（旧方案，已被 1、2 取代）。
>

```rust
// ===== 变量/常量/静态全局：原理速记 =====
// 1. Rust 没有"未初始化变量"，let 绑定要么附初值，要么明确延迟初始化再读 (例如 let x; x = 1;)。
// 2. 默认绑定不可变 (let x = 10;)，要修改需 mut (let mut n = 10;)。
// 3. 重新 let 同名 = "遮蔽 (shadowing)"：可以改类型、可以不改值，但每次都生成新绑定。
// 4. const 常量在编译期就地求值，并可被内联；不分配固定内存地址。
// 5. static 是真正放在全局内存里、有地址的变量；static mut 读写必须包在 unsafe 块里。
// 6. 全局初始化不允许调用非常量函数；const fn 编译器可求值，普通 fn 不行。
//    因此静态 + 需要运行时计算的初始值，三件套是：lazy_static / OnceCell / LazyLock。

const MAX_LENGTH: i32 = 10;
static COMPANY_NAME: &'static str = "我是球长";
const THE_ANSWER: u32 = 56;
static mut MEEP: u32 = 666;

// 方案一
static MY_STATIC:u32 = foo();

const fn foo() -> u32{
    42
}

// 方案二
const MY_STATIC1:u32 = foo1();

const fn foo1() -> u32{
    42
}

// 方案三
use lazy_static::lazy_static;
lazy_static!{
    static ref MY_STATIC2:u32 = foo2();
}

fn foo2() -> u32{
    42
}

// 方案四
use std::sync::LazyLock;
static MY_STATIC3: LazyLock<u32> = LazyLock::new(|| {
    foo3()
});

fn foo3() -> u32 {
    42
}

fn main() {
    // 错误❌ 没赋值
    // let number;
    // println!("{}",number);

    let number;
    number = 1;
    println!("{}", number);
    // number = 3;  // 错误 number 不可变只能 赋值一次

    let mut _n = 10;
    _n = 300;
    let _n = 666;
    // _n = 999; // 错误！第二次声明变量类型为不可变

    let long_lived_binding = 2;
    {
        let short_lived_binding = 3;
        println!("{}", short_lived_binding);

        println!("{}", long_lived_binding);

        let long_lived_binding = 5_f32;
        println!("{}", long_lived_binding);
    }
    // 外部不能访问内部作用域的 资源
    println!("{}", long_lived_binding);

    let long_lived_binding = "asdasdasdas";
    println!("{}", long_lived_binding);

    let outer = 42;
    {
        let inner = 3.14;
        println!("{}", inner);
        let outer = "AAAAA";
        println!("{}", outer);
    }
    println!("{}", outer);

    unsafe {
        println!(
            "{} {} {} {}",
            MAX_LENGTH,
            COMPANY_NAME,
            THE_ANSWER,
            *(&raw const MEEP)
        );
        MEEP = 666666;
        println!("{}",*(&raw const MEEP));
    }
}
```

**（含外部 crate **`lazy_static`**；通过 **`cargo run --bin 变量`** 或在前文对应的 src/Chapter4 文件直接 **`cargo run`** 运行。）**

**（教学片段，直接复制 src/Chapter4/ 对应文件即可运行。）**

## 1.10.6 别名
```rust
fn main() {
type ThresholdEntry = u16;
let _init: ThresholdEntry = 56789;
}
```

`type` 定义**类型别名**，仅是名字替换，**不创建新类型**。`ThresholdEntry` 与 `u16` 完全同型。

`newtype`（1.6.2 节）是真创建类型：能避免与被包装类型混淆。

## 1.10.7 类型转换
### 数值强转 (`as`)
`as` 仅限**有明确字节布局的转换**，主要在数值与 `bool → u8 / char → u32` 之间使用：

```rust
fn main() {
let decimal = 65.4321_f32;
let int: u8     = decimal as u8;     // 截断小数部分
let ch: char    = int as char;       // u8 -> char（仅 ASCII 合法）
let n: i32      = 1000 as i32;       // 同型不必要
let back: u8    = (-1i8) as u8;      // 位级回卷
}
```

> `as` **不是**通用转换。任意自定义类型 A -> B 必须实现 `From<B> for A`（或 `Into<A>`）。
>

### 数值转型 (`TryFrom` / `From`)
```rust
fn main() {
use std::convert::TryInto;
let a: i32  = 10;
let b: u16  = 100;
let b_: u32 = b.try_into().unwrap();
if a < b_ as i32 { println!("自动推导") }
}
```

**已编译运行。**

```latex
自动推导
```

`try_into()` 在安全场景下使用，可丢失时倾向 `From/Into` 不可失败的转换。

## 1.10.8 零长度类型
零大小类型（ZST, Zero Sized Type）：

+ 大小为 0，编译器不分配内存；
+ 类型仍然存在，可作为类型参数、标记；

```rust
fn main() {
struct Marker;                        // 0 字节
enum Void {}                          // 也可（无变体）
let arr: [i32; 0] = [];               // 数组 0 长度
}
```

ZST 常用于类型驱动：让 `HashMap<K, ()>` 当集合用，让单元类型 `()` 当"我不在乎返回值"信号。
