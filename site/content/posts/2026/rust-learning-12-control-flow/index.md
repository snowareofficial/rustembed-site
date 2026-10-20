---
title: "1.11 控制语句"
author: cxi
date: 2026-10-20
tags: [ rust 控制流 ]
summary: "match、if、循环、if let / while let 的写法与匹配规则。"
series:
  id: rust-learning
  title: "Rust 学习"
  order: 12
map: true
---

## 1.11.1 match
`match` 是 Rust 唯一的**穷尽模式匹配**：`match value { ... }` 的每一个分支都必须处理 value 类型的所有可能——缺失任何一个变体，编译不通过。

```rust
// ===== 控制流：原理速记 =====
// 1. Rust 的"所有分支必须汇合到同一类型"是 if 表达式能赋值给变量的关键；
//    if-else 的所有分支必须是同一个类型 ()、i32 或同种枚举。
// 2. match 是穷尽匹配的代数 match：
//      - 必须覆盖所有变体（每个枚举/布尔/数值都被处理），否则编译失败；
//      - 模式可绑定变量 (n @ 28)、可区间 (1..3)、可或 (5|7|13)、可解构 (Some(x))；
//      - 末尾 _ 是兜底通配，要放最后并避免挡到更具体分支。
// 3. if let 与 while let 是只关心"成功那一支"的语法糖，本质仍是 match + 单一模式。

fn main() {
    let mut y = 5;
    let x = (y = 6); // x --> () 空元组
    println!("{:?} {}", x, y);
    let x = add_one(y);
    println!("{}", x);

    let status = if true { 666 } else { -1 };
    println!("{}", status);

    let no = 28;
    match no {
        0 => println!(" Zero"),
        1..3 => println!(" All"),
        5 | 7 | 13 => println!(" Bad Luck"),
        n @ 28 => println!("Answer is {} ", n), // 相当于 n==28
        _ => println!("default"),
        // 支持 ... 全域
    }

    // 不可驳 = 一定匹配成功
    // 可驳   = 可能匹配失败
    // 不可辩驳性 -- 无争议
    let tuple = (10, 20);
    let (x, y) = tuple;
    println!("{} {}", x, y);

    // 可驳性 -- 一个模式（pattern）在匹配某个值时，是否可能失败。
    let value = Some(10);

    if let Some(x) = value {
        println!("{}", x);
    }

    {
        let twenty = double_number("10");
        print(twenty);
        let tt = double_number_map("t");
        print(tt);
    }
}

fn add_one(x: i32) -> i32 {
    x + 1
}

// fn tt()
// {
//     let next_char:char = 'H';
//     match next_char{
//         '0'..'9' => println!("No1"),
//         'a'..'z' | 'A'..'Z' => println!("No2"),
//         ' ' | '\t' | '\n' => println!("No3"),
//         _ => println!("..."),
//     }

// match  rebot.last_know_location(){
//     Some(point) if self.distance_to(point) < 10 => short_distance_strategy(point),
//     Some(point) => long_dxxxx(point),
//     None => aa()
// }

// match self.get_s() {
//     Shape::Rect(top_left,bottom_right) => op(&Shape(top_left,bottom_right)),
//     other_ => print_o(other_)
// }

// match account {
//     Account(name,language,..) => {
//         ui.greet(name,language),
//         ui.show(&account)
//     }
// }

// match chars.peek {
//     Some(&pattern) => println!("gyhjk {}",pattern),
//     None => println!("gvbhjnk"),
// }

// match get_accout(id){
//     Some(Account{
//         name,language,
//         .....
//     }) => language.show(name)
// }

// let calendar = match settings.get("xx") {
//     "1" => Calendar::x,
//     "2" => Calendar::y,
//     "3" => Calendar::z,
//     other => return xxxxx,
// };

// let caption = match photo.tagged_pet(){
//     Pet::Tyrannosaur => "RAH",
//     Pet::Samoyed => "*jfhjd*",
//     _ => "那肯定是疯狂"
// };

// match meadow.count_rabbits() {
//     0 => {},
//     1 => .....
//     n => println!("xxx {}",n)
// }

// fn hsl_to_rgb(hsl: [u8;3]) -> [u8;3]{
//     match hsl{
//         [_,_,0] => [0,0,0],[_,_,255] => [255,255,255]
//         ...
//     }
// }

// fn greet_prople(names: &[&str]){
//     match names{
//         [] => {println!("drftgyhuijo")},
//         [a] => {println!("dxfcgvhbjnkm {}",a)},
//         [a,b] => {println!("fghjtgyhu{} {}"),a,b},
//         [a,..,b] => {println!("dryftghjdftgh{} {}",a,b)}
//     }
// }
// }

use std::num::ParseIntError;

fn double_number(number_str: &str) -> Result<i32, ParseIntError> {
    match number_str.parse::<i32>() {
        Ok(n) => Ok(2 * n),
        Err(e) => Err(e),
    }
}

fn double_number_map(number_str: &str) -> Result<i32, ParseIntError> {
    number_str.parse::<i32>().map(|n| 2 * n)
}

fn print(result: Result<i32, ParseIntError>) {
    match result {
        Ok(n) => println!("n is {}", n),
        Err(e) => println!("Error: {}", e),
    }
}
```

**已编译运行（取自 **`src/Chapter4/控制语句.rs`**）。**

```latex
() 6
7
666
Answer is 28 
10 20
10
n is 20
Error: invalid digit found in string
```

模式丰富：

| 模式 | 含义 |
| --- | --- |
| `1..3` | 区间匹配 |
| `5 | 7 | 13` | 或 |
| `n @ 28` | 绑定 + 守卫 |
| `Some(x)` / `(a, b)` / `Point { x, y }` | 解构 |
| `_` | 通配符，不要挡在具体分支之前 |
| `0` | 字面量 |


`match` 也支持守卫（guard）：

```rust
// ===== 控制流：原理速记 =====
// 1. Rust 的"所有分支必须汇合到同一类型"是 if 表达式能赋值给变量的关键；
//    if-else 的所有分支必须是同一个类型 ()、i32 或同种枚举。
// 2. match 是穷尽匹配的代数 match：
//      - 必须覆盖所有变体（每个枚举/布尔/数值都被处理），否则编译失败；
//      - 模式可绑定变量 (n @ 28)、可区间 (1..3)、可或 (5|7|13)、可解构 (Some(x))；
//      - 末尾 _ 是兜底通配，要放最后并避免挡到更具体分支。
// 3. if let 与 while let 是只关心"成功那一支"的语法糖，本质仍是 match + 单一模式。

fn main() {
    let mut y = 5;
    let x = (y = 6); // x --> () 空元组
    println!("{:?} {}", x, y);
    let x = add_one(y);
    println!("{}", x);

    let status = if true { 666 } else { -1 };
    println!("{}", status);

    let no = 28;
    match no {
        0 => println!(" Zero"),
        1..3 => println!(" All"),
        5 | 7 | 13 => println!(" Bad Luck"),
        n @ 28 => println!("Answer is {} ", n), // 相当于 n==28
        _ => println!("default"),
        // 支持 ... 全域
    }

    // 不可驳 = 一定匹配成功
    // 可驳   = 可能匹配失败
    // 不可辩驳性 -- 无争议
    let tuple = (10, 20);
    let (x, y) = tuple;
    println!("{} {}", x, y);

    // 可驳性 -- 一个模式（pattern）在匹配某个值时，是否可能失败。
    let value = Some(10);

    if let Some(x) = value {
        println!("{}", x);
    }

    {
        let twenty = double_number("10");
        print(twenty);
        let tt = double_number_map("t");
        print(tt);
    }
}

fn add_one(x: i32) -> i32 {
    x + 1
}

// fn tt()
// {
//     let next_char:char = 'H';
//     match next_char{
//         '0'..'9' => println!("No1"),
//         'a'..'z' | 'A'..'Z' => println!("No2"),
//         ' ' | '\t' | '\n' => println!("No3"),
//         _ => println!("..."),
//     }

// match  rebot.last_know_location(){
//     Some(point) if self.distance_to(point) < 10 => short_distance_strategy(point),
//     Some(point) => long_dxxxx(point),
//     None => aa()
// }

// match self.get_s() {
//     Shape::Rect(top_left,bottom_right) => op(&Shape(top_left,bottom_right)),
//     other_ => print_o(other_)
// }

// match account {
//     Account(name,language,..) => {
//         ui.greet(name,language),
//         ui.show(&account)
//     }
// }

// match chars.peek {
//     Some(&pattern) => println!("gyhjk {}",pattern),
//     None => println!("gvbhjnk"),
// }

// match get_accout(id){
//     Some(Account{
//         name,language,
//         .....
//     }) => language.show(name)
// }

// let calendar = match settings.get("xx") {
//     "1" => Calendar::x,
//     "2" => Calendar::y,
//     "3" => Calendar::z,
//     other => return xxxxx,
// };

// let caption = match photo.tagged_pet(){
//     Pet::Tyrannosaur => "RAH",
//     Pet::Samoyed => "*jfhjd*",
//     _ => "那肯定是疯狂"
// };

// match meadow.count_rabbits() {
//     0 => {},
//     1 => .....
//     n => println!("xxx {}",n)
// }

// fn hsl_to_rgb(hsl: [u8;3]) -> [u8;3]{
//     match hsl{
//         [_,_,0] => [0,0,0],[_,_,255] => [255,255,255]
//         ...
//     }
// }

// fn greet_prople(names: &[&str]){
//     match names{
//         [] => {println!("drftgyhuijo")},
//         [a] => {println!("dxfcgvhbjnkm {}",a)},
//         [a,b] => {println!("fghjtgyhu{} {}"),a,b},
//         [a,..,b] => {println!("dryftghjdftgh{} {}",a,b)}
//     }
// }
// }

use std::num::ParseIntError;

fn double_number(number_str: &str) -> Result<i32, ParseIntError> {
    match number_str.parse::<i32>() {
        Ok(n) => Ok(2 * n),
        Err(e) => Err(e),
    }
}

fn double_number_map(number_str: &str) -> Result<i32, ParseIntError> {
    number_str.parse::<i32>().map(|n| 2 * n)
}

fn print(result: Result<i32, ParseIntError>) {
    match result {
        Ok(n) => println!("n is {}", n),
        Err(e) => println!("Error: {}", e),
    }
}
```

**已编译运行（取自 **`src/Chapter4/控制语句.rs`**）。**

```latex
() 6
7
666
Answer is 28 
10 20
10
n is 20
Error: invalid digit found in string
```

`match` 始终要求表达式是**单一类型**——要么都返回 `()`，要么都返回某种一致类型，例如 `Result<T, E>` 处理。

### 表达性 vs 语句性
```rust
// ===== 控制流：原理速记 =====
// 1. Rust 的"所有分支必须汇合到同一类型"是 if 表达式能赋值给变量的关键；
//    if-else 的所有分支必须是同一个类型 ()、i32 或同种枚举。
// 2. match 是穷尽匹配的代数 match：
//      - 必须覆盖所有变体（每个枚举/布尔/数值都被处理），否则编译失败；
//      - 模式可绑定变量 (n @ 28)、可区间 (1..3)、可或 (5|7|13)、可解构 (Some(x))；
//      - 末尾 _ 是兜底通配，要放最后并避免挡到更具体分支。
// 3. if let 与 while let 是只关心"成功那一支"的语法糖，本质仍是 match + 单一模式。

fn main() {
    let mut y = 5;
    let x = (y = 6); // x --> () 空元组
    println!("{:?} {}", x, y);
    let x = add_one(y);
    println!("{}", x);

    let status = if true { 666 } else { -1 };
    println!("{}", status);

    let no = 28;
    match no {
        0 => println!(" Zero"),
        1..3 => println!(" All"),
        5 | 7 | 13 => println!(" Bad Luck"),
        n @ 28 => println!("Answer is {} ", n), // 相当于 n==28
        _ => println!("default"),
        // 支持 ... 全域
    }

    // 不可驳 = 一定匹配成功
    // 可驳   = 可能匹配失败
    // 不可辩驳性 -- 无争议
    let tuple = (10, 20);
    let (x, y) = tuple;
    println!("{} {}", x, y);

    // 可驳性 -- 一个模式（pattern）在匹配某个值时，是否可能失败。
    let value = Some(10);

    if let Some(x) = value {
        println!("{}", x);
    }

    {
        let twenty = double_number("10");
        print(twenty);
        let tt = double_number_map("t");
        print(tt);
    }
}

fn add_one(x: i32) -> i32 {
    x + 1
}

// fn tt()
// {
//     let next_char:char = 'H';
//     match next_char{
//         '0'..'9' => println!("No1"),
//         'a'..'z' | 'A'..'Z' => println!("No2"),
//         ' ' | '\t' | '\n' => println!("No3"),
//         _ => println!("..."),
//     }

// match  rebot.last_know_location(){
//     Some(point) if self.distance_to(point) < 10 => short_distance_strategy(point),
//     Some(point) => long_dxxxx(point),
//     None => aa()
// }

// match self.get_s() {
//     Shape::Rect(top_left,bottom_right) => op(&Shape(top_left,bottom_right)),
//     other_ => print_o(other_)
// }

// match account {
//     Account(name,language,..) => {
//         ui.greet(name,language),
//         ui.show(&account)
//     }
// }

// match chars.peek {
//     Some(&pattern) => println!("gyhjk {}",pattern),
//     None => println!("gvbhjnk"),
// }

// match get_accout(id){
//     Some(Account{
//         name,language,
//         .....
//     }) => language.show(name)
// }

// let calendar = match settings.get("xx") {
//     "1" => Calendar::x,
//     "2" => Calendar::y,
//     "3" => Calendar::z,
//     other => return xxxxx,
// };

// let caption = match photo.tagged_pet(){
//     Pet::Tyrannosaur => "RAH",
//     Pet::Samoyed => "*jfhjd*",
//     _ => "那肯定是疯狂"
// };

// match meadow.count_rabbits() {
//     0 => {},
//     1 => .....
//     n => println!("xxx {}",n)
// }

// fn hsl_to_rgb(hsl: [u8;3]) -> [u8;3]{
//     match hsl{
//         [_,_,0] => [0,0,0],[_,_,255] => [255,255,255]
//         ...
//     }
// }

// fn greet_prople(names: &[&str]){
//     match names{
//         [] => {println!("drftgyhuijo")},
//         [a] => {println!("dxfcgvhbjnkm {}",a)},
//         [a,b] => {println!("fghjtgyhu{} {}"),a,b},
//         [a,..,b] => {println!("dryftghjdftgh{} {}",a,b)}
//     }
// }
// }

use std::num::ParseIntError;

fn double_number(number_str: &str) -> Result<i32, ParseIntError> {
    match number_str.parse::<i32>() {
        Ok(n) => Ok(2 * n),
        Err(e) => Err(e),
    }
}

fn double_number_map(number_str: &str) -> Result<i32, ParseIntError> {
    number_str.parse::<i32>().map(|n| 2 * n)
}

fn print(result: Result<i32, ParseIntError>) {
    match result {
        Ok(n) => println!("n is {}", n),
        Err(e) => println!("Error: {}", e),
    }
}
```

**已编译运行（取自 **`src/Chapter4/控制语句.rs`**）。**

```latex
() 6
7
666
Answer is 28 
10 20
10
n is 20
Error: invalid digit found in string
```

## 1.11.2 if
`if` 是**表达式**：

```rust
/*
 if / else
 if / else if / else
*/

fn main()
{
    {
        let x = 10;
        let y = if x == 10{
            100
        }
        else{
            200
        };
        println!("{} {}",x,y);
    }

    {
        let var1 = Some(100);
        if let Some(vec2) = var1{
            println!("{} ",vec2);
        }
        // 等价于
        let var1 = Some(100);
        match var1 {
            Some(var2) => println!("{} ",var2),
            None => ()
        }
    }
    {
        let with_wings = false;
        let suggested_pot = if with_wings{"Buzzard"} else {"fghjlkm"};
        // let suggested_pot = if with_wings{"Buzzard"} else {9}; // 错误
    }
    
}
```

**已编译运行（取自 **`src/Chapter4/if判断.rs`**）。**

```latex
10 100
100 
100 
```

`if let` 把"只关心一项匹配"的 `match` 浓缩为更紧凑的语法糖：

```rust
fn main() {
    let x = loop {
        break 100;
    };
    println!("{} ", x);

    let n = 12;
    let is_even = |x: u64| -> bool { x % 2 == 0 };
    let description = if is_even(n) {
        "even number"
    } else {
        "odd number"
    };
    println!("{} is{} ", n, description);

    let mut optional = Some(0);

    while let Some(i) = optional {
        if i > 9 {
            println!("Greater than 9,quit!");
            optional = None;
            // break;
        } else {
            println!("`i` is `{:?}` .Try again.", i);
            optional = Some(i+1);
        }
    }
    // println!("{}",optional.unwrap()); // optional = None; 失败
    if let Some(v) = optional{
        println!("{} ",v);
    }
    else {
        println!("optional 是空 None");
    }

}
```

**已编译运行（取自 **`src/Chapter4/循环1.rs`**）。**

```latex
100 
12 iseven number 
`i` is `0` .Try again.
`i` is `1` .Try again.
`i` is `2` .Try again.
`i` is `3` .Try again.
......
`i` is `6` .Try again.
`i` is `7` .Try again.
`i` is `8` .Try again.
`i` is `9` .Try again.
Greater than 9,quit!
optional 是空 None
```

等价于：

```rust
/*
 if / else
 if / else if / else
*/

fn main()
{
    {
        let x = 10;
        let y = if x == 10{
            100
        }
        else{
            200
        };
        println!("{} {}",x,y);
    }

    {
        let var1 = Some(100);
        if let Some(vec2) = var1{
            println!("{} ",vec2);
        }
        // 等价于
        let var1 = Some(100);
        match var1 {
            Some(var2) => println!("{} ",var2),
            None => ()
        }
    }
    {
        let with_wings = false;
        let suggested_pot = if with_wings{"Buzzard"} else {"fghjlkm"};
        // let suggested_pot = if with_wings{"Buzzard"} else {9}; // 错误
    }
    
}
```

**已编译运行（取自 **`src/Chapter4/if判断.rs`**）。**

```latex
10 100
100 
100 
```

## 1.11.3 循环语句
### `loop`：无限循环
```rust
fn main() {
let x = loop {
    break 100;                         // break 表达式
};

// 命名循环与 break 'outer
'outer: loop {
    'inner: loop {
        break 'outer;                  // 直接跳出外层
    }
    println!("此处永不执行");
}
}
```

### `while`：条件循环
```rust
fn main() {
let mut n = 1;
while n < 20 {
    if n % 10 == 0 { break; }
    n += 1;
}
}
```

发散函数 `-> !` 是永远不会返回的函数，常用作 while 里：

```rust
fn main() {
fn divergess() -> ! { panic!("never returns"); }
}
```

### `for`：迭代循环
```rust
fn main() {
let mut cot = [1, 2, 3, 4];
for i in cot        { /* i 是 i32，移动所有权 */ }
for i in &cot       { /* i 是 &i32，借用只读   */ }
for i in &mut cot   { *i += 1; /* 通过解引用原地改 */ }
for (idx, val) in cot.iter().enumerate() { println!("{idx}={val}"); }
}
```

**已编译运行。**

```latex
0=2
1=3
2=4
3=5
```

三条迭代形式分别对应"消费 / 只读借用 / 可变借用"，是借用检查器在迭代器协议的核心写照。

### `for ... in` 的三种语义
| 语句 | 等价于 | 访问方式 |
| --- | --- | --- |
| `for item in collection` | `for item in IntoIterator::into_iter(collection)` | 所有权 |
| `for item in &collection` | `for item in collection.iter()` | 只读 |
| `for item in &mut collection` | `for item in collection.iter_mut()` | 可读可写 |


> + 上面三种形式其实是同一个 trait `IntoIterator` 的三种 `into_iter` 视图：`into_iter`（消耗所有权）、`iter`（返回 `&T`）、`iter_mut`（返回 `&mut T`）。
> + 编译器会按"集合类型 + mut 修饰"自动派发到对应的实现：基础类型 `[T; N]` / `[T]` / `Vec<T>` 都自带这三套，所以 `for` 在数组、切片、向量、HashMap、BufRead 上的语法是一致的。
> + `for` 循环里不能再直接调用 **第三方**`next()`；如果碰到无限迭代 + 中途退出，用 `'label: for ... { break 'label ... }`。
>

## 1.11.4 if let / while let
```rust
fn main() {
let mut optional = Some(0);
while let Some(i) = optional {
    if i > 9 { optional = None; }
    else     { optional = Some(i + 1); }
}
}
```

`while let` 反复尝试解构：成功就走循环体，失败就 break。常见用途：循环读 `Option`/`Result`、`BufRead::lines()` 等迭代器。

### `loop { break 值; }` 表达式（`循环1.rs` 演示）
`loop` 也是表达式，可以带回值：

```rust
fn main() {
let x = loop { break 100; };           // x = 100
}
```

这一行体现 Rust 的两个设计：

+ `loop` 没有自然终止条件，必须靠 `break` 退出；
+ `break 100` 把 100 作为整条 `loop` 表达式的值传给外层 `let`。

### 链式 `while let Some(i) = optional`
```rust
fn main() {
let mut optional = Some(0);
while let Some(i) = optional {
    if i > 9 {
        optional = None;               // 终止信号：把 Some 改为 None
    } else {
        optional = Some(i + 1);        // 否则自增并继续
    }
}
}
```

要点：

1. `while let Some(i) = optional { ... }` 等价 `loop { match optional { Some(i)=>..., None=>break } }`，但更紧凑。
2. 想终止循环不必 `break`，只要让 `optional` 变成不匹配的模式（这里是 `None`）。
3. 退出循环后 `optional == None`，调用 `optional.unwrap()` 会 panic，需要 `if let Some(v) = ... else { ... }` 兜底。
