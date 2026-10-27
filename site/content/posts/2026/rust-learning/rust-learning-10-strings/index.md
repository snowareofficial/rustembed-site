---
title: "1.9 字符串"
author: cxi
date: 2026-10-20
tags: [ rust 字符串 ]
summary: "字符串切片、String、字节字符串、Cow 以及各种字符串转换与操作。"
series:
  id: rust-learning
  title: "Rust 学习"
  order: 10
map: true
---

Rust 把"字符串"分成了层次分明的若干类型：理解它们是处理文本的关键。

## 1.9.1 字符串切片
`&str` 是胖指针 `(ptr, len)`，永远指向**合法 UTF-8** 的连续字节序列、不可变。

```rust
fn main() {
let dog = "大智如愚";                          // &'static str 指向常量段
let first: String = dog.chars().take(1).collect();
let fifth: String = dog.chars().skip(1).collect();
}
```

⚠️ **绝不能按字节下标切片**：

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
......
Hello Milly!
Hello Human!

true
4
a b c d erer over 解析IP成功: fe80::3ea9:f4ff:fe34:7a50
```

`"你好".len() == 6`（3 字节一个字），`"王者吃鸡".chars().count() == 4`。遇到需要按字符切片的情况，用迭代器 + `take` / `skip` / `collect`。

## 1.9.2 字符串
`String` = `Vec<u8>` + UTF-8 校验。

```rust
use core::slice;

const CONSTANT_STRING: &'static str = "This is a constant string";
fn main()
{
    let another_string = "This string is local to string";
    println!("Constant string says: {} ",CONSTANT_STRING);
    println!("Another string says: {} ",another_string);
    {
        let mut s = "hello"; // &str 类型 是只读、不可变、UTF-8 字符串切片，底层字符不允许直接修改
        // s[0] = 'c'; // 错误 非 C/C++ 直接支持索引
        // s.push('\n');
        s = "12345";
        println!("{}",s);

        let a:String = "Hello".to_string();
        println!("{}",a);
        let b = String::from("你好");
        println!("{}",b);
        let c = "Milly".to_owned();
        println!("{}",c);
        let d = c.clone(); // 拷贝
        println!("{}",d);
        let e = format!("{2} {1} {0}","C","B","A"); // 类似 C的 sprintf
        println!("{}",e);
        let bits = vec!["veni","vidi","vivi"];
        assert_eq!(bits.concat(),"venividivivi"); // concat 拼接/链接
        assert_eq!(bits.join(","),"veni,vidi,vivi");
    }
    {
        let s = "Hello".to_string();
        takes_slice(&s);
    }
}

fn takes_slice(slice: &str){
    println!("Got: {}",slice);
}
```

**已编译运行（取自 **`src/Chapter4/字符串.rs`**）。**

```latex
Constant string says: This is a constant string 
Another string says: This string is local to string 
12345
Hello
你好
Milly
Milly
A B C
Got: Hello
```

特点：

1. 可增长：`.push_str(...)` / `.push(char)`。
2. 不会自动截断：`.pop()` 只在非空合法 UTF-8 边界才返回字符。
3. 拼接：`String + &str` → `String`；`String + &String` 也行（自动 deref）：

```rust
fn main() {
let hello_world = "Hello".to_string() + "Milly"; // String + &str -> String
}
```

### `String` 的常用成员方法
| 方法 | 说明 |
| --- | --- |
| `String::new()` | 分配一个空的 `String` 类型 |
| `String::from(s: &str)` | 分配一个新的 `String`，并赋初值（传入字符串切片） |
| `String::with_capacity(capacity: usize)` | 以指定的大小分配一个空的 `String` 类型 |
| `String::from_utf8(vec: Vec<u8>)` | 通过字节字符串生成一个新的 `String` 类型。参数必须是合法的 UTF-8 编码，否则会失败。返回 `Result` 类型 |
| `len()` | 返回 `String` 类型的长度。是字节计数（书中描述存在笔误，并非 Unicode 字符计数） |
| `push(ch: char)` | 给字符串增加一个字符 |
| `push_str(string: &str)` | 给字符串增加一个字符串切片 |


> 补充：
>
> + `String::from_utf8(vec)` 失败时返回 `Err(String::fromUtf8Error)`，要拿到原 Vec 就只能 `unwrap_or_else(|e| e.into_bytes())`。
> + `String` 还提供 `pop()` / `remove(idx)` / `truncate(len)` / `clear()` / `split_at(mid)` / `replace_range(range, replace_with)` / `drain(range)` 等系列可写方法；以及 `contains(&str)` / `starts_with` / `ends_with` / `find` / `trim` / `chars` / `bytes` 等只读方法。完整列表见 [std::string::String](https://doc.rust-lang.org/std/string/struct.String.html)。
>

## 1.9.3 字节字符串
```rust
fn main() {
let method = b"SET";                          // &[u8; 3] 的字节数组
let s = std::str::from_utf8(method).unwrap(); // &[u8] -> &str，校验失败会 panic
}
```

字节串绕过 UTF-8 校验，适合网络协议、二进制字段。但何时都不能被 `&str` 接住而不校验。

## 1.9.4 其他字符串类型
| 类型 | 用途 |
| --- | --- |
| `&str` / `String` | Rust 内部通用 UTF-8 文本 |
| `CStr` / `CString` | 与 C 互操作的 `\0` 结尾字符串 |
| `OsStr` / `OsString` | 与操作系统原生字符串（Windows UTF-16 / Unix bytes） |
| `Path` / `PathBuf` | 文件系统路径 |
| `Cow<'_, str>` | 写时复制：能在 `&str` 与 `String` 间互转而不额外分配 |


```rust
fn main() {
use std::ffi::{CStr, CString};
let c = CString::new("hello").unwrap();        // 含 \\0 校验
}
```

## 1.9.5 各种字符串类型之间转换
由于 `String: Deref<Target = str>`，所以：

```rust
fn main() {
let s: String = "hi".to_string();
let r: &str = &s;                              // 隐式 deref，无需 as_str()
let _ = s.as_str();                            // 显式方法，性质相同
let _h: String = s;                            // &str -> String 也要 .to_string()
}
```

`Cow` 的精髓——**避免无为分配**：

```rust
fn main() {
use std::borrow::Cow;
fn greet(name: Option<&str>) -> Cow<'static, str> {
    match name {
        Some(n) => Cow::from(format!("Hello {}!\r\n", n)),
        None    => Cow::from("Hello Human!\r\n"),
    }
}
}
```

`name == Some` 时返回 `Cow::Owned(String)`，`None` 时返回 `Cow::Borrowed(&'static str)`。调用方按需 `.into_owned()` 拿到 `String`。

## 1.9.6 写时复制
`Cow<'a, B>` = `Clone-on-Write`，是 `Borrowed(&'a B) | Owned(<B as ToOwned>::Owned)` 的枚举：

```rust
use std::borrow::Cow;
fn greet(name: Option<&str>) -> Cow<'static, str> {
    match name {
        Some(n) => Cow::from(format!("Hello {}!\r\n", n)),
        None    => Cow::from("Hello Human!\r\n"),
    }
}

fn main() {
let s = String::from("Hello");
let _: Cow<str> = Cow::from(s);                // Owned 分支
let _: Cow<str> = Cow::from("Milly");          // Borrowed 分支，零分配
}
```

读时和 `&str` 相同；若第一次写入则触发分配并切换到 Owned 分支。常用于"既要接收借用，又要可能分配"的双形态 API。

## 1.9.7 字符串相关操作
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

通用解析 `FromStr`：

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
