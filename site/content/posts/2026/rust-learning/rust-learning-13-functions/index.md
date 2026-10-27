---
title: "1.12 函数"
author: cxi
date: 2026-10-20
tags: [ rust 函数 ]
summary: "函数定义与返回、const fn、参数模式解构与提前返回。"
series:
  id: rust-learning
  title: "Rust 学习"
  order: 13
map: true
---

```rust
fn main() {
fn add_one(x: i32) -> i32 { x + 1 }       // 标准签名
fn divergess() -> ! { panic!("!"); }       // 发散函数：永返回
fn fib(x: i64) -> i64 {                    // 递归
    if x == 0 || x == 1 { return x; }
    fib(x - 1) + fib(x - 2)
}
}
```

要点：

| 概念 | 解释 |
| --- | --- |
| 签名末尾无 `;` | 自动返回值就是表达式，免 `return` |
| 末尾 `;` | 等价 `return ();`，函数返回 `unit` |
| `!` 发散 | 函数永不返回，可强制任何分支返回同一类型 |
| 递归 | 没有尾调用优化（TCO）保证；大递归请用迭代 |
| 函数指针 | `fn(i32) -> i32` 是一类值，可赋给变量、传参、做返回值 |
| 函数当参数 | 形如 `F: Fn(i32) -> i32`，是泛型闭包约束 |
| 函数嵌套 | 内部函数闭包外层局部变量（闭包捕获） |


```rust
struct Circle {
    x: f64,
    y: f64,
    redius: f64,
}

impl Circle {
    fn area(&self) -> f64 {
        std::f64::consts::PI * (self.redius * self.redius)
    }
    fn grow(&self, increment: f64) -> Circle {
        Circle {
            x: self.x,
            y: self.y,
            redius: self.redius + increment,
        }
    }
}

fn main() {
    print_sum(5, 6);
    println!(" {}", add_one(65));
    // divergess();

    let ans = fib(10);
    println!("{} ", ans);

    let x: fn(i32) -> i32 = foo;
    let f = foo;
    let e = f(10);
    let k = x(55);
    println!("{} {}", e, k);

    // ========== 调用 again 示例 ==========
    // 1. 传入普通函数 foo
    let a1 = again(foo, 10);
    println!("again(foo,10) = {}", a1);

    // 2. 传入自定义闭包
    let a2 = again(|v| v * 3, 2);
    println!("again(|v|v*3,2) = {}", a2);

    // 3. 传入函数指针变量x
    let a3 = again(x, 5);
    println!("again(x,5) = {}", a3);

    {
        let c = Circle {
            x: 0.0,
            y: 0.0,
            redius: 2.0,
        };
        println!("{} ", c.area());
        println!("{} ", c.grow(2.0).area());
    }

    {
        let a = [11, 22, 33, 44, 55, 66, 77];
        let mut v = Vec::<i32>::new();
        for i in &a {
            let f = get_func(*i);
            v.push(f(*i));
        }
        println!("{:?} ", v);
    }

    // CHECKSUM
    println!("0x{:X} ",CHECKSUM);

    {
        let x = S{
            field1:'Z',
            field2: true,
        };
        someFunc(x);
    }

    {
        let a: i32 = 10;
        let b: u16 = 100;
        let b_ = b.try_into().unwrap();
        if a < b_{
            println!("自动推导")
        }
    }
}

fn print_sum(x: i32, y: i32) {
    print!("{}", x + y);
}

fn add_one(x: i32) -> i32 {
    // return x;
    x + 1
}

// 发散函数
fn divergess() -> ! {
    panic!("This function never returns!");
}

// fn seerve_forever(socket: ServerSocket, handler: ServerHandler) -> !{
//     socket.listen();
//     loop {
//         let s = socket.accept();
//         handler.handle(s);
//     }
// }

fn fib(x: i64) -> i64 {
    if x == 0 || x == 1 {
        return x;
    }
    fib(x - 1) + fib(x - 2)
}

fn foo(x: i32) -> i32 {
    x + 1
}

fn again<F: Fn(i32) -> i32>(f: F, s: i32) -> i32 {
    f(f(s))
}

// 函数里面 可以写函数
/*
    fn a{
        fn b{
            fn c{

            }
        }
    }
*/

type timesType = fn(i32) -> i32;

fn get_func(n: i32) -> fn(i32) -> i32 {
    fn double(n: i32) -> i32 {
        n * 2
    }
    fn triple(n: i32) -> i32 {
        n * 3
    }
    if n % 2 == 0 { double } else { triple }
}

const CHECKSUM: u32 = salt(56);
const fn salt(a:u32) -> u32{
    0xDEADBEEF ^ a
}

struct S{
    field1:char,
    field2:bool,
}

fn someFunc(S{field1:arg1,field2:arg2}:S)
{
    println!("{} {} ",arg1,arg2);
}
```

**已编译运行（取自 **`src/Chapter4/函数.rs`**）。**

```latex
11 66
55 
11 56
again(foo,10) = 12
again(|v|v*3,2) = 18
again(x,5) = 7
12.566370614359172 
50.26548245743669 
[33, 44, 99, 88, 165, 132, 231] 
0xDEADBED7 
Z true 
自动推导
```

## 提早返回
```rust
fn main() {
fn classify(s: &str) -> &'static str {
    if s.is_empty() { return "empty"; }   // 提前返回
    if s.len() > 10 { return "long"; }
    "short"
}
}
```

## 函数作为返回值
```rust
fn main() {
type Op = fn(i32) -> i32;
fn get_func(n: i32) -> Op {
    fn double(n: i32) -> i32 { n * 2 }
    fn triple(n: i32) -> i32 { n * 3 }
    if n % 2 == 0 { double } else { triple }
}
}
```

## 常量函数（`const fn`）
```rust
fn main() {
const fn salt(a: u32) -> u32 { 0xDEADBEEF ^ a }
const CHECKSUM: u32 = salt(56);   // 编译期就计算好
}
```

`const fn` 是编译期可执行的函数。Rust 不断扩展其能力（1.46 起 mut 绑定，1.51 起 if/match，1.61 起 trait 默认方法）。

## 模式解构参数
```rust
fn main() {
struct S { field1: char, field2: bool }
fn someFunc(S { field1: arg1, field2: arg2 }: S) {
    println!("{} {}", arg1, arg2);
}
}
```

参数处的模式解构是"先解构、再调用"——既能匹配，又能在签名清晰表达。
