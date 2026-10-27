---
title: "1.15 impl 代码块"
author: cxi
date: 2026-10-20
tags: [ rust trait ]
summary: "固有实现、trait 实现与关联函数/方法。"
series:
  id: rust-learning
  title: "Rust 学习"
  order: 16
---

`impl` 是 Rust 在类型上"挂载方法"的语法区。它**不能**在外部包里给别人的类型加方法（孤儿规则），但同包内能扩展自己写的类型。

```rust
fn main() {
struct Point { x: i32, y: i32 }
impl Point {
    fn new(name: &str) -> Point {                          // 关联函数 (关联构造器)
        println!("{}", name);
        Point { x: 0, y: 0 }
    }
    fn set_xy(mut self, x: i32, y: i32) -> Self {          // 链式调用：消耗 self
        self.x = x; self.y = y; self
    }
}
}
```

### 三种 receiver
| 签名 | 用法 |
| --- | --- |
| `fn foo(self)` | 消耗 self，原调用者失去所有权 |
| `fn foo(&self)` | 只读借用 |
| `fn foo(&mut self)` | 可变借用 |


### 给运算符实现 trait
```rust
use std::ops::Mul;

struct Point {
    x: i32,
    y: i32,
}

impl Point {
    fn new(name: &str) -> Point {
        println!("{}", name);
        Point { x: 0, y: 0 }
    }
    // 方便测试赋值坐标
    fn set_xy(mut self, x: i32, y: i32) -> Self {
        self.x = x;
        self.y = y;
        self
    }
}

impl Mul for Point {
    type Output = Point;
    fn mul(self, other: Point) -> Point {
        println!("{} {}", other.x, other.y);
        // 使用两个点的坐标相乘
        Point {
            x: self.x * other.x,
            y: self.y * other.y,
        }
    }
}

enum Day {
    Monday,
    Tuesday,
    Wednesday,
    Thursday,
    Friday,
    Saturday,
    Sunday
}

impl Day {
    fn mood(&self){
        // self 类型：&Day（不可变引用
        // *self 类型：Day（解引用后本体，匹配时会拷贝 / 复制枚举）
        println!("{}",match *self {
            Day::Monday => "A",
            Day::Tuesday => "B",
            Day::Wednesday => "C",
            Day::Thursday => "D",
            Day::Friday => "E",
            _ => "周末..."
        })
    }
}

fn main() {
    let a = Point::new("hello").set_xy(7, 8);
    let b = Point { x: 6, y: 7 };
    // a * b，等价 a.mul(b)
    let res = a.mul(b);
    // let res = a * b; // 也可以
    println!("相乘结果 x={}, y={}", res.x, res.y);

    let today = Day::Tuesday;
    today.mood();
}
```

**已编译运行（取自 **`src/Chapter4/impl代码块.rs`**）。**

```latex
hello
6 7
相乘结果 x=42, y=56
B
```

### 给枚举实现方法
```rust
use std::ops::Mul;

struct Point {
    x: i32,
    y: i32,
}

impl Point {
    fn new(name: &str) -> Point {
        println!("{}", name);
        Point { x: 0, y: 0 }
    }
    // 方便测试赋值坐标
    fn set_xy(mut self, x: i32, y: i32) -> Self {
        self.x = x;
        self.y = y;
        self
    }
}

impl Mul for Point {
    type Output = Point;
    fn mul(self, other: Point) -> Point {
        println!("{} {}", other.x, other.y);
        // 使用两个点的坐标相乘
        Point {
            x: self.x * other.x,
            y: self.y * other.y,
        }
    }
}

enum Day {
    Monday,
    Tuesday,
    Wednesday,
    Thursday,
    Friday,
    Saturday,
    Sunday
}

impl Day {
    fn mood(&self){
        // self 类型：&Day（不可变引用
        // *self 类型：Day（解引用后本体，匹配时会拷贝 / 复制枚举）
        println!("{}",match *self {
            Day::Monday => "A",
            Day::Tuesday => "B",
            Day::Wednesday => "C",
            Day::Thursday => "D",
            Day::Friday => "E",
            _ => "周末..."
        })
    }
}

fn main() {
    let a = Point::new("hello").set_xy(7, 8);
    let b = Point { x: 6, y: 7 };
    // a * b，等价 a.mul(b)
    let res = a.mul(b);
    // let res = a * b; // 也可以
    println!("相乘结果 x={}, y={}", res.x, res.y);

    let today = Day::Tuesday;
    today.mood();
}
```

**已编译运行（取自 **`src/Chapter4/impl代码块.rs`**）。**

```latex
hello
6 7
相乘结果 x=42, y=56
B
```
