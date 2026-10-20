---
title: "1.19 其他"
author: cxi
date: 2026-10-20
tags: [ rust 基础 ]
summary: "下画线、格式化输出、类型清单与保留字等杂项。"
series:
  id: rust-learning
  title: "Rust 学习"
  order: 20
map: true
---

## 1.19.1 下画线
`_` 是"占位通配"——告诉编译器"我故意不用它"，常常用作：

| 位置 | 含义 |
| --- | --- |
| 变量名 | `let _ = ...;` 不警告未用 |
| 数值字面量 | `1_000_000` 仅分隔 |
| 模式 | `let (_, x) = (1, 2);` 只取第二个 |
| 类型参数 | `Vec<_>` 让编译器自动推断 |
| trait 方法 | `trait T { fn foo(&self) -> _; }`（1.75+，不规则返回位置） |


多种用法意义不同，但都共享"忽略 / 推导"。

## 1.19.2 字符串格式化输出
来自 `std::fmt`：

```rust
use std::fmt::{Display,Formatter};

#[derive(Debug)]
struct T{
    field1:i32,
    field2:i32
}

impl Display for T{
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} {}",self.field1,self.field2)
    }
}

fn main() {
    let octal = 0o_777_205_162;
    let binary = 0b_0110_1001_1111_0001;
    println!("{:o} {:b}", octal, binary);

    let p = (1, 2);
    let mut a = 0;
    println!("a = {}", a);
    (_, a) = p;
    println!("a = {}", a);

    let ten = 10;
    let ws = 5;
    println!("{ten:>ws$}");
    println!("{ten:>0ws$}");
    println!("{ten:-<ws$}");
    println!("{ten:^ws$}");
    println!("{ten:#^10}");
    println!("{:e}",std::f64::consts::PI);

    let var = T{field1:2,field2:6};
    println!("{} ",var);
    println!("{:?} ",var);
    println!("{:#?}",var);
}
```

**已编译运行（取自 **`src/Chapter4/基础end.rs`**）。**

```latex
777205162 110100111110001
a = 0
a = 2
   10
00010
10---
......
2 6 
T { field1: 2, field2: 6 } 
T {
    field1: 2,
    field2: 6,
}
```

占位符：

+ `{位置}`：参数索引。
+ `{名字}`：命名参数。
+ `{位置:填充对齐符号宽度.精度 类型}`：格式规范。
+ `{位置:fill align sign # 0 width .precision type}`：完整说明符。

### 宽度、填充字符、对齐：`{ten:>ws$}` 形态（`基础end.rs`）
字段宽度、对齐符号、填充字符都可以**由变量提供**，用 `$` 标注"参数引用"：

```rust
fn main() {
let ten = 10;
let ws  = 5;
println!("{ten:>ws$}");      // 默认 fill=' ' align='>'： '   10'
println!("{ten:>0ws$}");     // fill='0' align='>'     ： '00010'
println!("{ten:-<ws$}");     // fill='-' align='<'     ： '10---'
println!("{ten:^ws$}");      // 默认 fill=' ' align='^' ： ' 10  '
println!("{ten:#^10}");      // 字面量宽度：fill='#'，居中宽 10：'####10####'
println!("{:e}", std::f64::consts::PI);   // 3.141592653589793e0
}
```

**已编译运行。**

```latex
   10
00010
10---
 10  
####10####
3.141592653589793e0
```

> 完整 spec 的语义：`[fill][align][sign][#][0][width][.precision][type]`。  
所有字段都可引用变量，引用语法是名字加 `$`（如 `ws$`）。`0` 是"用零填充"的快捷标志。
>

### 同一类型，三种打印（`基础end.rs`）
```rust
use std::fmt::{Display,Formatter};

#[derive(Debug)]
struct T{
    field1:i32,
    field2:i32
}

impl Display for T{
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} {}",self.field1,self.field2)
    }
}

fn main() {
    let octal = 0o_777_205_162;
    let binary = 0b_0110_1001_1111_0001;
    println!("{:o} {:b}", octal, binary);

    let p = (1, 2);
    let mut a = 0;
    println!("a = {}", a);
    (_, a) = p;
    println!("a = {}", a);

    let ten = 10;
    let ws = 5;
    println!("{ten:>ws$}");
    println!("{ten:>0ws$}");
    println!("{ten:-<ws$}");
    println!("{ten:^ws$}");
    println!("{ten:#^10}");
    println!("{:e}",std::f64::consts::PI);

    let var = T{field1:2,field2:6};
    println!("{} ",var);
    println!("{:?} ",var);
    println!("{:#?}",var);
}
```

**已编译运行（取自 **`src/Chapter4/基础end.rs`**）。**

```latex
777205162 110100111110001
a = 0
a = 2
   10
00010
10---
 10  
......
3.141592653589793e0
2 6 
T { field1: 2, field2: 6 } 
T {
    field1: 2,
    field2: 6,
}
```

当一个类型同时实现了 `Display` 与 `Debug`，按 spec 选择：

| spec | 调用的 trait |
| --- | --- |
| `{}` / `{:.3}` | `Display`（必须用户实现） |
| `{:?}` / `{:#?}` | `Debug`（通常 `#[derive(Debug)]`） |


> 自定义结构体想 `{}` 可用，**必须**手写 `impl Display`，不能从 `#[derive]` 得到。
>

### 整数后缀打印（`基础end.rs`）
`{:o}`、`{:b}`、`{:x}`、`{:X}` 分别按八/二/十六进制打印整数：

```rust
fn main() {
println!("{:o} {:b}", 0o_777_205_162, 0b_0110_1001_1111_0001);
// 777205162 10011001011110001
}
```

**已编译运行。**

```latex
777205162 110100111110001
```

## 1.19.3 Rust 类型清单
```latex
标量:  i8/16/32/64/isize   u8/16/32/64/usize   f32/f64   bool   char   ()
复合:  [T; N]   [T]    (T1, T2, ...)    struct/枚举
引用:  &T   &mut T   *const T   *mut T
智能指针: Box<T>   Rc<T>   Arc<T>   RefCell<T>   Mutex<T>   Cow<'a, T>   Pin<T>
容器:  Vec<T>   String   HashMap<K,V>   BTreeMap<K,V>   HashSet<T>   BTreeSet<T>   VecDeque<T>   LinkedList<T>   BinaryHeap<T>
并发:  mpsc::Sender/Receiver<T>   thread::JoinHandle<T>
其它:  Option<T>   Result<T,E>   fn   &[T]   &str
```

## 1.19.4 Rust 保留字
`as、break、const、continue、crate、else、enum、extern、false、fn、for、if、impl、in、let、loop、match、mod、move、mut、pub、ref、return、self、Self、static、struct、super、trait、true、type、unsafe、use、where、while` 加 2024 起的 `gen`（async 块级生成器提案相关关键字之一）。

另外关键**严格关键字** `dyn`（trait object 前缀，1.0+ 已严格）必须出现在 `dyn Trait` 上下文。

## 1.19.5 其他
### 类型擦除：`Box<dyn Trait>`
```rust
// ===== 字符串1：原理速记 =====
// Rust 中"字符串"实际是一组层次不同的类型：
//   &str                  不可变 UTF-8 切片 (fat pointer: ptr+len)；字符串字面量就是它。
//   String                可增长、堆分配、可变的 UTF-8 字符串，等价 Vec<u8> 保证合法 UTF-8。
//   &String               自动 deref 成 &str，惯例上传递只读字符串就用 &str。
//   CStr / CString        与 C 互操作的、以 '\0' 结尾的字节串（不要求 UTF-8）。
//   OsStr / OsString      与操作系统原生字符串（Windows UTF-16、Unix bytes）互操作。
//   Path / PathBuf        文件系统路径，OS 无关视图。
//   b"..." / &[u8] / Vec<u8> 字节视图，不校验 UTF-8，适合二进制协议。
//   Cow<'_, str>          "写时复制"：有所有权就保留，没有就分配新 String。
// 取下标时必须按字符边界：&s[0..2] 以字节为单位，遇到非 ASCII 多字节字符会 panic。
// 应改用 chars()/bytes() 迭代 + take()/skip()/collect() 来切片。

use std::{
    borrow::Cow,
    ffi::{CStr, CString, OsStr, OsString},
    net::{IpAddr, TcpStream},
    path::{Path, PathBuf},
    str::FromStr,
};

// pub fn connect<A: ToSocketAddrs>(addr: A) -> Result<TcpStream>
// pub trait ToSocketAddrs {
//     type Iter: Iterator<Item = SocketAddr>;

//     fn to_socket_addrs(&self) -> Result<Self::Iter>;
// }

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let _ = TcpStream::connect("192.168.0.1:6000");
    let addr_string = "192.168.0.1:6000".to_string();
    // .as_str()是只读、不可变、UTF-8 字符串切片，底层字符不允许直接修改
    let _h = addr_string.as_str();
    let _ = TcpStream::connect(addr_string.as_str());
    let _ = TcpStream::connect(&*addr_string);
    let _string: String = addr_string.into();

    let dog = "taoism";
    let taois = &dog[0..5];
    println!("{}", taois);

    let dog = "大智如愚";
    // let hachi = &dog[0..2]; // 大 --- 不是像C++ 直接取
    // .take(k) 的含义：从迭代器取出前 k 个字符
    // .collect() 是迭代器通用方法，把迭代器所有元素收集、转换成目标容器。
    let hachi: String = dog.chars().take(1).collect();
    println!("{}", hachi);
    // .skip(n) 跳过前 n 个字符
    let hachi: String = dog.chars().skip(1).collect();
    println!("{}", hachi);

    assert_eq!("你好".len(), 6); // 2x3
    assert_eq!("王者吃鸡".chars().count(), 4);

    {
        let taoism = "大智如愚";
        for b in taoism.as_bytes() {
            // 字节数组 字节偏移量
            print!("0x{:x} ", b);
        }
        println!("");
        for b in taoism.chars() {
            print!("{} ", b);
        }
        println!("");
    }

    // &str 类似索引访问 不可修改
    {
        let taoism = "大智如愚";
        let dog = taoism.chars().nth(1).unwrap();
        println!("{}", dog);
    }
    {
        let hello = "Hello".to_string();
        let milly = "Milly!";
        let hello_world = hello + milly; // String + &str --> String
        println!("{}", hello_world);

        let hello = "Hello".to_string();
        let milly = "Milly!".to_string();
        let hello_world = hello + &milly; // String + &String --> String
        println!("{}", hello_world);
    }

    {
        let method = b"SET";
        println!("{:?}", method);
        println!("{}", std::str::from_utf8(method).unwrap());
        assert_eq!(method, &[b'S', b'E', b'T']);
    }

    // 字符类型装切片
    {
        let s = String::from("hello");
        let os_s = OsString::from("Foo");
        let path_s = PathBuf::from(r"/home/matt/.bashrc");
        let c_s = CString::new("CString !").unwrap();
        // let c_s = CString::from("C sdsd "); // 错误

        let _ref_s: &str = &s; // 默认是 通过推到 为String 指定后 为&str
        let _ref_os_s: &OsStr = &os_s;
        let _ref_path_s: &Path = &path_s;
        let _ref_c_s: &CStr = &c_s;
    }

    // 写时复制
    {
        let s = String::from("Hello");
        let _c1 = Cow::from(s);
        let _c2 = Cow::from("Milly");

        let g1 = greet(Some("Milly"));
        let g2 = greet(None);

        println!("{}{}", g1, g2);
    }

    // 字符串相关操作
    {
        assert!(" ONE".to_lowercase() == " one"); // 字符取小 变小写
        assert!(" peanut".contains("nut"));
        println!("{}", " peanut".contains("nut")); // 查找
        println!("{}", " peanut".find("nut").unwrap()); // 查找

        assert_eq!("哈_哈".replace("哈", "呵"), "呵_呵"); // 替代
        assert_eq!("clean\n".trim(), "clean");
        for word in "a,b,c,d,erer,over".split(",")
        //分割
        {
            print!("{} ", word);
        }
        assert!("123456".starts_with("1"));
        assert!("123456".ends_with("6"));
    }

    {
        use std::str::FromStr;
        // 直接转换为 字符 -> 数据
        assert_eq!(usize::from_str("3628800"), Ok(3628800));
        assert_eq!(f64::from_str("128.5625"), Ok(128.5625));
        assert_eq!(bool::from_str("true"), Ok(true));
        assert!(f64::from_str("hdjasjhjd").is_err());
        assert!(bool::from_str("TEUE").is_err());

        assert_eq!(char::from_str(")"), Ok(')'));
        assert!(char::from_str("jhrdals").is_err());
    }
    // 切片
    {
        let address = "fe80::0000:3ea9:f4ff:fe34:7a50".parse::<IpAddr>()?;
        println!("解析IP成功: {}", address);
    }
    Ok(())
}

fn greet(name: Option<&str>) -> Cow<'static, str> {
    match name {
        Some(name) => Cow::from(format!("Hello {}!\r\n", name)),
        None => Cow::from("Hello Human!\r\n"),
    }
}

// trait 是行为接口，用来给不同类型定义共享的能力 / 方法，类似 Java / C++ 的接口、抽象类，但功能更强。核心：描述 “这个类型能做什么”，而非描述 “它是什么”。
// pub trait FromStr: Sized {
//     type Err;
//     fn from_str(s: &str) -> Result<Self, Self::Err>;
// }

fn parse_pair<T: FromStr>(s: &str, separator: char) -> Option<(T, T)> {
    match s.find(separator) {
        None => None,
        Some(index) => match (T::from_str(&s[..index]), T::from_str(&s[index + 1..])) {
            (Ok(l), Ok(r)) => Some((l, r)),
            _ => None,
        },
    }
}
```

**已编译运行（取自 **`src/Chapter4/字符串1.rs`**）。**

```latex
taois
大
智如愚
0xe5 0xa4 0xa7 0xe6 0x99 0xba 0xe5 0xa6 0x82 0xe6 0x84 0x9a 
大 智 如 愚 
智
HelloMilly!
......
SET
Hello Milly!
Hello Human!

true
4
a b c d erer over 解析IP成功: fe80::3ea9:f4ff:fe34:7a50
```

当函数不能指定具体错误类型时用 `Box<dyn Error>` 收敛各类型。`字符串1.rs` 的 `fn main() -> Result<(), Box<dyn std::error::Error>>` 正是这种用法。

### 闭包与 trait
| 闭包 | 对应 trait |
| --- | --- |
| `|x| x + 1` | `Fn(&T) -> R`，不消费捕获 |
| `let mut n = 0; |x| { n += x; }` | `FnMut(&T) -> R`，可变借用 |
| `let s = "...".to_string(); || drop(s)` | `FnOnce() -> R`，消耗自身 |


```rust
fn main() {
fn twice<F: Fn(i32) -> i32>(f: F, x: i32) -> i32 { f(x) + f(x) }
}
```

### 类型推导
Rust 自带局部类型推导，但在版本约束里：

+ 函数参数与返回值一般显式；
+ 闭包参数可用 `|x: i32| { x + 1 }`；
+ 结构字段、枚举变体总是显式。

### 协程 / async
新版 Rust 原生支持 `async`/`.await`：

```rust
// ===== 字符串1：原理速记 =====
// Rust 中"字符串"实际是一组层次不同的类型：
//   &str                  不可变 UTF-8 切片 (fat pointer: ptr+len)；字符串字面量就是它。
//   String                可增长、堆分配、可变的 UTF-8 字符串，等价 Vec<u8> 保证合法 UTF-8。
//   &String               自动 deref 成 &str，惯例上传递只读字符串就用 &str。
//   CStr / CString        与 C 互操作的、以 '\0' 结尾的字节串（不要求 UTF-8）。
//   OsStr / OsString      与操作系统原生字符串（Windows UTF-16、Unix bytes）互操作。
//   Path / PathBuf        文件系统路径，OS 无关视图。
//   b"..." / &[u8] / Vec<u8> 字节视图，不校验 UTF-8，适合二进制协议。
//   Cow<'_, str>          "写时复制"：有所有权就保留，没有就分配新 String。
// 取下标时必须按字符边界：&s[0..2] 以字节为单位，遇到非 ASCII 多字节字符会 panic。
// 应改用 chars()/bytes() 迭代 + take()/skip()/collect() 来切片。

use std::{
    borrow::Cow,
    ffi::{CStr, CString, OsStr, OsString},
    net::{IpAddr, TcpStream},
    path::{Path, PathBuf},
    str::FromStr,
};

// pub fn connect<A: ToSocketAddrs>(addr: A) -> Result<TcpStream>
// pub trait ToSocketAddrs {
//     type Iter: Iterator<Item = SocketAddr>;

//     fn to_socket_addrs(&self) -> Result<Self::Iter>;
// }

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let _ = TcpStream::connect("192.168.0.1:6000");
    let addr_string = "192.168.0.1:6000".to_string();
    // .as_str()是只读、不可变、UTF-8 字符串切片，底层字符不允许直接修改
    let _h = addr_string.as_str();
    let _ = TcpStream::connect(addr_string.as_str());
    let _ = TcpStream::connect(&*addr_string);
    let _string: String = addr_string.into();

    let dog = "taoism";
    let taois = &dog[0..5];
    println!("{}", taois);

    let dog = "大智如愚";
    // let hachi = &dog[0..2]; // 大 --- 不是像C++ 直接取
    // .take(k) 的含义：从迭代器取出前 k 个字符
    // .collect() 是迭代器通用方法，把迭代器所有元素收集、转换成目标容器。
    let hachi: String = dog.chars().take(1).collect();
    println!("{}", hachi);
    // .skip(n) 跳过前 n 个字符
    let hachi: String = dog.chars().skip(1).collect();
    println!("{}", hachi);

    assert_eq!("你好".len(), 6); // 2x3
    assert_eq!("王者吃鸡".chars().count(), 4);

    {
        let taoism = "大智如愚";
        for b in taoism.as_bytes() {
            // 字节数组 字节偏移量
            print!("0x{:x} ", b);
        }
        println!("");
        for b in taoism.chars() {
            print!("{} ", b);
        }
        println!("");
    }

    // &str 类似索引访问 不可修改
    {
        let taoism = "大智如愚";
        let dog = taoism.chars().nth(1).unwrap();
        println!("{}", dog);
    }
    {
        let hello = "Hello".to_string();
        let milly = "Milly!";
        let hello_world = hello + milly; // String + &str --> String
        println!("{}", hello_world);

        let hello = "Hello".to_string();
        let milly = "Milly!".to_string();
        let hello_world = hello + &milly; // String + &String --> String
        println!("{}", hello_world);
    }

    {
        let method = b"SET";
        println!("{:?}", method);
        println!("{}", std::str::from_utf8(method).unwrap());
        assert_eq!(method, &[b'S', b'E', b'T']);
    }

    // 字符类型装切片
    {
        let s = String::from("hello");
        let os_s = OsString::from("Foo");
        let path_s = PathBuf::from(r"/home/matt/.bashrc");
        let c_s = CString::new("CString !").unwrap();
        // let c_s = CString::from("C sdsd "); // 错误

        let _ref_s: &str = &s; // 默认是 通过推到 为String 指定后 为&str
        let _ref_os_s: &OsStr = &os_s;
        let _ref_path_s: &Path = &path_s;
        let _ref_c_s: &CStr = &c_s;
    }

    // 写时复制
    {
        let s = String::from("Hello");
        let _c1 = Cow::from(s);
        let _c2 = Cow::from("Milly");

        let g1 = greet(Some("Milly"));
        let g2 = greet(None);

        println!("{}{}", g1, g2);
    }

    // 字符串相关操作
    {
        assert!(" ONE".to_lowercase() == " one"); // 字符取小 变小写
        assert!(" peanut".contains("nut"));
        println!("{}", " peanut".contains("nut")); // 查找
        println!("{}", " peanut".find("nut").unwrap()); // 查找

        assert_eq!("哈_哈".replace("哈", "呵"), "呵_呵"); // 替代
        assert_eq!("clean\n".trim(), "clean");
        for word in "a,b,c,d,erer,over".split(",")
        //分割
        {
            print!("{} ", word);
        }
        assert!("123456".starts_with("1"));
        assert!("123456".ends_with("6"));
    }

    {
        use std::str::FromStr;
        // 直接转换为 字符 -> 数据
        assert_eq!(usize::from_str("3628800"), Ok(3628800));
        assert_eq!(f64::from_str("128.5625"), Ok(128.5625));
        assert_eq!(bool::from_str("true"), Ok(true));
        assert!(f64::from_str("hdjasjhjd").is_err());
        assert!(bool::from_str("TEUE").is_err());

        assert_eq!(char::from_str(")"), Ok(')'));
        assert!(char::from_str("jhrdals").is_err());
    }
    // 切片
    {
        let address = "fe80::0000:3ea9:f4ff:fe34:7a50".parse::<IpAddr>()?;
        println!("解析IP成功: {}", address);
    }
    Ok(())
}

fn greet(name: Option<&str>) -> Cow<'static, str> {
    match name {
        Some(name) => Cow::from(format!("Hello {}!\r\n", name)),
        None => Cow::from("Hello Human!\r\n"),
    }
}

// trait 是行为接口，用来给不同类型定义共享的能力 / 方法，类似 Java / C++ 的接口、抽象类，但功能更强。核心：描述 “这个类型能做什么”，而非描述 “它是什么”。
// pub trait FromStr: Sized {
//     type Err;
//     fn from_str(s: &str) -> Result<Self, Self::Err>;
// }

fn parse_pair<T: FromStr>(s: &str, separator: char) -> Option<(T, T)> {
    match s.find(separator) {
        None => None,
        Some(index) => match (T::from_str(&s[..index]), T::from_str(&s[index + 1..])) {
            (Ok(l), Ok(r)) => Some((l, r)),
            _ => None,
        },
    }
}
```

**已编译运行（取自 **`src/Chapter4/字符串1.rs`**）。**

```latex
taois
大
智如愚
0xe5 0xa4 0xa7 0xe6 0x99 0xba 0xe5 0xa6 0x82 0xe6 0x84 0x9a 
大 智 如 愚 
智
HelloMilly!
......
SET
Hello Milly!
Hello Human!

true
4
a b c d erer over 解析IP成功: fe80::3ea9:f4ff:fe34:7a50
```

`Future` 是一个 trait——`async fn` 实质返回 `impl Future<Output = T>`。
