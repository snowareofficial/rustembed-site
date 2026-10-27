---
title: "1.18 Rust 标准库"
author: cxi
date: 2026-10-20
tags: [ rust 标准库 ]
summary: "Rust 标准库的特点与常用模块速查。"
series:
  id: rust-learning
  title: "Rust 学习"
  order: 19
---

## 1.18.1 Rust 标准库的特点
1. **零垃圾回收**：纯借用 + 移动语义，无需 GC。
2. **零成本抽象**：迭代器、`?` 错误传播、`impl Trait` 都是 0 开销。
3. **trait 化**：能力靠 trait 表达：`Iterator`、`Read`、`Write`、`From`/`Into`、`AsRef`/`AsMut`、`Default`、`Debug`/`Display`。
4. **无 unsafe 即可写 Rust**：标准库对常见容器（`Vec`、`BTreeMap`、`HashMap`）提供安全 API。
5. **小内核（**`core`**） + 完整 std**：库能嵌入裸机，只用 `core`；用 OS 调度再 `std`。
6. **强测试 + 文档示例**：每个公共 API 都附带 doc-test 样例。

## 1.18.2 Rust 标准库模块（速查）
| 模块 | 关键内容 |
| --- | --- |
| `std::collections` | `HashMap`、`BTreeMap`、`VecDeque`、`HashSet`、`BTreeSet`、`LinkedList`、`BinaryHeap` |
| `std::convert` | `From`/`Into`、`TryFrom`/`TryInto`、`AsRef`/`AsMut` |
| `std::fmt` | `Debug`/`Display` 格式化、`write!`、`format!` |
| `std::fs` | 文件系统：`File::create/open`、`metadata`、`read_dir` |
| `std::io` | `Read`/`Write`/`Seek` trait、`BufReader`/`BufWriter`、`stdin()`/`stdout()` |
| `std::iter` | 迭代器：`map`/`filter`/`take`/`skip`/`collect`/`fold`/`sum` |
| `std::mem` | `size_of`/`align_of`/`transmute`/`replace`/`swap` |
| `std::ops` | 重载运算符：`Add`/`Sub`/`Mul`/`Div`/`Neg`/`Index`/`Deref`/`Range` |
| `std::path` | `Path`/`PathBuf` |
| `std::process` | 进程：`Command`、`exit`、`stdin/stdout/stderr` |
| `std::sync` | `Mutex`/`RwLock`/`Arc`/`Barrier`/`mpsc` 通道 |
| `std::thread` | `spawn`/`sleep`/`JoinHandle` |
| `std::time` | `Duration`/`Instant`/`SystemTime` |
| `std::net` | Tcp/Udp、`IpAddr` |


### trait 的设计哲学
+ 消费型：`IntoIterator`，接收 `self`；
+ 借用型：`Iterator`，总是给 `&Self`；
+ 错误型：`From`、`TryFrom`，把任意输入转成目标类型；
+ 类型归约：`Default`，给"逻辑零值"。

> 示例：用 `IntoIterator` 让结构体能 `for v in xs`：
>

```rust
fn main() {
struct MyVec<T>(Vec<T>);
impl<T> IntoIterator for MyVec<T> {
    type Item = T;
    type IntoIter = std::vec::IntoIter<T>;
    fn into_iter(self) -> Self::IntoIter { self.0.into_iter() }
}
}
```
