---
title: "1.7 枚举"
author: cxi
date: 2026-10-20
tags: [ rust 枚举 类型 ]
summary: "C 风格枚举、带数据枚举、混合枚举，内存布局与代数数据类型。"
series:
  id: rust-learning
  title: "Rust 学习"
  order: 8
map: true
---

Rust 的 `enum` 是**带标签联合 (tagged union)**：每个变体本质是一组"判别字段 + 可选载荷"的命名空间。判别字段由编译器插入，运行期根据它判断当前占用哪个变体。

## 1.7.1 C 风格的枚举类型
```rust
fn main() {
enum Continent { Europe, Asia, Africa, America, Oceania }
}
```

字段为空的枚举在 Rust 里叫"裸枚举"。不写属性时**不保证**显式 `as i32 == 0/1/...`，需要整型值时显式声明：

```rust
fn main() {
#[repr(u8)]
enum Continent2 { Europe = 0, Asia = 1 }     // 锁定为 u8
}
```

```rust
fn main() {
enum HttpStatus { Ok = 200, NotModified = 304, NotFound = 404 }
let code = HttpStatus::Ok as i32;
}
```

## 1.7.2 带数据的枚举类型
```rust
fn main() {
enum Shape {
    Circle(f64),                  // 圆：半径
    Rectangle { w: f64, h: f64 }, // 矩形：名字段 struct
    Triangle { a: f64, b: f64, c: f64 },
}
}
```

每个变体可以携带不同的字段集合。配合 `match` 解释：

```rust
use std::env;
use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;

fn main() {
    // 临时文件
    let temp_directory = env::temp_dir();
    let temp_file = temp_directory.join("file");
    println!("临时文件完整路径：{}", temp_file.display());
    // 只读打开，没有创建
    let mut file = File::create(&temp_file).unwrap();
    writeln!(&mut file, "Hello 王玉！").unwrap();
    file.write(b"Bytes\n").unwrap();

    match read_a_file(&temp_file) {
        Ok(content) => {
            println!("文件原始字节：{:?}", content);

            if let Ok(text) = String::from_utf8(content) {
                println!("文件文本内容：\n{text}");
            }
        }
        Err(e) => {
            println!("读取失败：{e}");
        }
    }
}

fn read_a_file(path: &Path) -> std::io::Result<Vec<u8>> {
    // let mut file = r#try!(File::open("file"));
    // let mut data = Vec::new();
    // r#try!(file.read_to_end(&mut data));
    // return Ok(data);
    let mut file = File::open(path)?;
    let mut data = Vec::new();

    file.read_to_end(&mut data)?;

    Ok(data)
}
```

**已编译运行（取自 **`src/Chapter4/writetxtfile.rs`**）。**

```latex
临时文件完整路径：/var/folders/w3/vm8nr9qn1jx093r4sb14_wy80000gn/T/file
文件原始字节：[72, 101, 108, 108, 111, 32, 231, 142, 139, 231, 142, 137, 239, 188, 129, 10, 66, 121, 116, 101, 115, 10]
文件文本内容：
Hello 王玉！
Bytes
```

编译器会强制你列举所有变体（穷尽匹配），缺一不可编译。

## 1.7.3 混合类型的枚举类型
```rust
fn main() {
enum ChessGameOp {
    Leftfly  { step: i32 },
    Rightfly { step: i32 },
    Move     { x: i32, y: i32 },
    Jump     { x: i32, y: i32 },
    Checkmate,
}
enum RelationshipStatus {
    Single,
    InARelationship,
    ItsComplicated(Option<String>),
}
}
```

枚举变体本身就是"模式"，可以嵌套：

```rust
// ===== 枚举：原理速记 =====
// 1. enum 的本质是"标签联合 (tagged union)"：编译器在内存中偷偷塞一个"判别字段"，
//    用来区分当前占用的是哪一个变体。变体所携带的数据按最严格对齐规则紧凑存放。
// 2. 默认布局 #[repr(Rust)]：编译器只为正确性负责，大小可能被优化到"看起来不合理"的紧凑，
//    因此枚举 -> 整型必须用 match 显式映射，禁止裸 transmute。
// 3. #[repr(<整数类型>)] 表示"裸枚举 (fieldless enum)"，可以当整型使用 (Ok as i32 = 200)。
// 4. #[repr(C)] 切换到 C-ABI：按声明顺序依次判别，方便与 C 库互操作。

// 同样可以 采用#[repr(C)]  #[repr(Rust)] 来声明 内存分布方式
enum Continent {
    Europe, // 0u8 --> 默认分支1
    Asia,
    Africa,
    America,
    Oceania,
}

enum HttpStatus {
    Ok = 200,
    NotModified = 304,
    NotFound = 404,
}

enum ChessGameOp {
    Leftfly { Step: i32 },
    Rightfly { Step: i32 },
    Move { x: i32, y: i32 },
    Jump { x: i32, y: i32 },
    Checkmate,
}

enum RelationshipStatus {
    Single,
    InARelationship,
    ItsComplicated(Option<String>),
    // ItsExtremelyComplicated{
    //     car: DifferentialEquation,
    //     cdr: EarlyModernistPome
    // }
}

use std::collections::HashMap;

enum Json {
    Null,
    boolean(bool),
    Number(f64),
    String(String),
    Array(Vec<Json>),
    Object(Box<HashMap<String, Json>>),
}

// ADT 模式
struct JSJIT(u64);
enum JSJITorExpr {
    Jit {
        value: u64,
    },
    String {
        value: String,
    },
    OperatorAdd {
        lexpr: Box<JSJITorExpr>,
        rexpr: Box<JSJITorExpr>,
    },
    OperatorMul {
        lexpr: Box<JSJITorExpr>,
        rexpr: Box<JSJITorExpr>,
    },
}

// ADT 异质例子
// 定义 HList 标记 trait，所有合法异构链表都实现它
pub trait HList {}

// 空链表，实现 HList
pub struct HNil;
impl HList for HNil {}

// 链表节点：头H + 尾T（T必须是HList）
pub struct HCons<H, T> {
    pub head: H,
    pub tail: T,
}

// 只要尾部T是HList，当前HCons就是合法HList
impl<H, T: HList> HList for HCons<H, T> {}

impl<H, T> HCons<H, T> {
    // pop 取出头部元素，返回 (head, 剩余尾部链表)
    pub fn pop(self) -> (H, T) {
        (self.head, self.tail)
    }
}

fn main() {
    let contion = Continent::Asia;
    match contion {
        Continent::Europe => println!("Eu"),
        Continent::Asia => println!("As"),
        Continent::Africa => println!("Af"),
        Continent::America => println!("Am"),
        Continent::Oceania => println!("O"),
    }

    assert_eq!(HttpStatus::Ok as i32, 200);

    let y: ChessGameOp = ChessGameOp::Jump { x: 1, y: 2 };
    let m = ChessGameOp::Leftfly { Step: 2 };
    let m1 = Play(5);

    println!("Size of Json: {}", std::mem::size_of::<Json>());
    println!("Size of bool: {}", std::mem::size_of::<bool>());
    println!("Size of f64: {}", std::mem::size_of::<f64>());
    println!("Size of String: {}", std::mem::size_of::<String>());
    println!("Size of Vector: {}", std::mem::size_of::<Vec<Json>>());
    println!(
        "Size of Box: {}",
        std::mem::size_of::<Box<HashMap<String, Json>>>()
    );
    println!(
        "Size of Json Tag + alignment: {}",
        std::mem::align_of::<Json>()
    );

    // 作用域
    {
        let h1 = HCons{
            head:2,
            tail:HCons{
                head:"abcd".to_string(),
                tail: HNil
            }
        };
        let (h1,t1) = h1.pop();
        let (h2,t2) =  t1.pop();

        // 下面的语句会触发报错：HNil 没有 .pop 方法
        // t2.pop();
    }
}

fn Play(step: i32) -> ChessGameOp {
    ChessGameOp::Leftfly { Step: step }
}

// ===== HList 异构链表原理 =====
// 异构链表 (Heterogeneous List) 让一条链表里每个节点存放不同类型的数据，
// 类型层级靠 trait HList 的递归实现约束：
//   HNil            是空链表
//   HCons<H, T>     只要 T: HList，自身也实现 HList
// 编译器据此推断：head 的类型由 H 决定，tail 的类型由剩余推断串起来。
// 这种"沿类型传播"是 Rust ADT 表达异构数据的关键。
```

**已编译运行（取自 **`src/Chapter4/枚举.rs`**）。**

```latex
As
Size of Json: 32
Size of bool: 1
Size of f64: 8
Size of String: 24
Size of Vector: 24
Size of Box: 8
Size of Json Tag + alignment: 8
```

注意递归类型不能直接放在自身字段中（无穷大小），必须用 `Box<T>`、`Vec<T>` 等堆指针间接指向自己。

## 1.7.4 枚举的内存布局
| 属性 | 含义 |
| --- | --- |
| 默认 `#[repr(Rust)]` | 字段紧凑、大小可能"看起来不合理"，编译器只为正确性负责 |
| `#[repr(u8/u16/...)]` | 判别字段锁定到指定宽度，仅适用**裸枚举** |
| `#[repr(C)]` | 锁定 C-ABI：判别字段大小由最窄整型变体决定，按声明顺序排 |
| `#[repr(transparent)]` | 单字段枚举与该字段内存等价（同址同大小同对齐） |


```rust
// ===== 枚举：原理速记 =====
// 1. enum 的本质是"标签联合 (tagged union)"：编译器在内存中偷偷塞一个"判别字段"，
//    用来区分当前占用的是哪一个变体。变体所携带的数据按最严格对齐规则紧凑存放。
// 2. 默认布局 #[repr(Rust)]：编译器只为正确性负责，大小可能被优化到"看起来不合理"的紧凑，
//    因此枚举 -> 整型必须用 match 显式映射，禁止裸 transmute。
// 3. #[repr(<整数类型>)] 表示"裸枚举 (fieldless enum)"，可以当整型使用 (Ok as i32 = 200)。
// 4. #[repr(C)] 切换到 C-ABI：按声明顺序依次判别，方便与 C 库互操作。

// 同样可以 采用#[repr(C)]  #[repr(Rust)] 来声明 内存分布方式
enum Continent {
    Europe, // 0u8 --> 默认分支1
    Asia,
    Africa,
    America,
    Oceania,
}

enum HttpStatus {
    Ok = 200,
    NotModified = 304,
    NotFound = 404,
}

enum ChessGameOp {
    Leftfly { Step: i32 },
    Rightfly { Step: i32 },
    Move { x: i32, y: i32 },
    Jump { x: i32, y: i32 },
    Checkmate,
}

enum RelationshipStatus {
    Single,
    InARelationship,
    ItsComplicated(Option<String>),
    // ItsExtremelyComplicated{
    //     car: DifferentialEquation,
    //     cdr: EarlyModernistPome
    // }
}

use std::collections::HashMap;

enum Json {
    Null,
    boolean(bool),
    Number(f64),
    String(String),
    Array(Vec<Json>),
    Object(Box<HashMap<String, Json>>),
}

// ADT 模式
struct JSJIT(u64);
enum JSJITorExpr {
    Jit {
        value: u64,
    },
    String {
        value: String,
    },
    OperatorAdd {
        lexpr: Box<JSJITorExpr>,
        rexpr: Box<JSJITorExpr>,
    },
    OperatorMul {
        lexpr: Box<JSJITorExpr>,
        rexpr: Box<JSJITorExpr>,
    },
}

// ADT 异质例子
// 定义 HList 标记 trait，所有合法异构链表都实现它
pub trait HList {}

// 空链表，实现 HList
pub struct HNil;
impl HList for HNil {}

// 链表节点：头H + 尾T（T必须是HList）
pub struct HCons<H, T> {
    pub head: H,
    pub tail: T,
}

// 只要尾部T是HList，当前HCons就是合法HList
impl<H, T: HList> HList for HCons<H, T> {}

impl<H, T> HCons<H, T> {
    // pop 取出头部元素，返回 (head, 剩余尾部链表)
    pub fn pop(self) -> (H, T) {
        (self.head, self.tail)
    }
}

fn main() {
    let contion = Continent::Asia;
    match contion {
        Continent::Europe => println!("Eu"),
        Continent::Asia => println!("As"),
        Continent::Africa => println!("Af"),
        Continent::America => println!("Am"),
        Continent::Oceania => println!("O"),
    }

    assert_eq!(HttpStatus::Ok as i32, 200);

    let y: ChessGameOp = ChessGameOp::Jump { x: 1, y: 2 };
    let m = ChessGameOp::Leftfly { Step: 2 };
    let m1 = Play(5);

    println!("Size of Json: {}", std::mem::size_of::<Json>());
    println!("Size of bool: {}", std::mem::size_of::<bool>());
    println!("Size of f64: {}", std::mem::size_of::<f64>());
    println!("Size of String: {}", std::mem::size_of::<String>());
    println!("Size of Vector: {}", std::mem::size_of::<Vec<Json>>());
    println!(
        "Size of Box: {}",
        std::mem::size_of::<Box<HashMap<String, Json>>>()
    );
    println!(
        "Size of Json Tag + alignment: {}",
        std::mem::align_of::<Json>()
    );

    // 作用域
    {
        let h1 = HCons{
            head:2,
            tail:HCons{
                head:"abcd".to_string(),
                tail: HNil
            }
        };
        let (h1,t1) = h1.pop();
        let (h2,t2) =  t1.pop();

        // 下面的语句会触发报错：HNil 没有 .pop 方法
        // t2.pop();
    }
}

fn Play(step: i32) -> ChessGameOp {
    ChessGameOp::Leftfly { Step: step }
}

// ===== HList 异构链表原理 =====
// 异构链表 (Heterogeneous List) 让一条链表里每个节点存放不同类型的数据，
// 类型层级靠 trait HList 的递归实现约束：
//   HNil            是空链表
//   HCons<H, T>     只要 T: HList，自身也实现 HList
// 编译器据此推断：head 的类型由 H 决定，tail 的类型由剩余推断串起来。
// 这种"沿类型传播"是 Rust ADT 表达异构数据的关键。
```

**已编译运行（取自 **`src/Chapter4/枚举.rs`**）。**

```latex
As
Size of Json: 32
Size of bool: 1
Size of f64: 8
Size of String: 24
Size of Vector: 24
Size of Box: 8
Size of Json Tag + alignment: 8
```

## 1.7.5 代数数据类型
代数数据类型（Algebraic Data Type，ADT）= "和 + 积"：

+ 积类型（product type）：结构体、各字段**同时存在**。
+ 和类型（sum type）：枚举、只能存**其中一个变体**。

```rust
fn main() {
enum Expr {
    Num(u64),                                  // 叶子
    Add(Box<Expr>, Box<Expr>),                 // 内部节点
    Mul(Box<Expr>, Box<Expr>),
}
}
```

> 提示：异构链表（HList）等高级类型推导，正来自"沿类型传播"ADT 的特性。
>
