---
title: "1.8 数组、切片和向量"
author: cxi
date: 2026-10-20
tags: [ rust 集合 ]
summary: "数组、Vec 与切片的区别、内存布局和常用操作。"
series:
  id: rust-learning
  title: "Rust 学习"
  order: 9
map: true
---

这是三种"放一排相同元素"的容器，但适用场景与内存模型截然不同。

## 1.8.1 数组
```rust
fn main() {
let a: [i32; 6]      = [1, 2, 4, 7, 11, 16];
let zeros            = [0; 20];          // 20 个 0
let sieve            = [false; 100];     // 100 个 false
let buffer           = [0u8; 1024];      // 1KB 缓冲
let taxonomy         = ["A1", "A2", "A3"];
println!("{}", taxonomy[1]);
}
```

**已编译运行。**

```latex
A2
```

数组特点：

1. 长度写在类型里 `[T; N]`，不同 N 是不同类型。
2. 默认栈分配，**不可增长**。
3. 索引越界 `panic`；数组 `.len()` 返回 `usize`。

泛型函数必须能让编译器推断 N：

```rust
// ===== 数组/向量：原理速记 =====
// 1. [T; N] 数组：长度 N 是类型的一部分 — [i32; 3] 与 [i32; 4] 是不同类型；
//    栈上固定分配，不会增长。语法 [expr; N] 让 N 个元素全部初始化为 expr。
// 2. Vec<T> 向量：堆上可变长、运行时分配，等价 "ptr + len + cap" 三元组。
//    Vec::new() 不分配，push 触发首次分配；之后 capacity 按 2 倍策略扩容。
//    用宏 vec![] 或 (a..b).collect::<Vec<_>>() 创建亦可。
// 3. 元素只能取 &/&mut，引用传递不会夺所有权；
//    移动时 let v2 = v1 会触发 Vec 的移动语义（仅搬运胖指针，原堆不动）。
// 4. 访问元素：v[i] 直接索引，越界会 panic；v.get(i) -> Option<&T> 安全。
// 5. 多维数组本质仍是"数组的数组"：let v: [[i32; 2]; 3] = ...。

fn main() {
    let _array1 = [10, 20, 30]; // 声明并赋初始值
    let _array2: [u32; 6] = [1, 2, 4, 7, 11, 16]; // 显示声明T和N

    let _array3 = [0; 20]; // array3: [i32;20] 数组是 20个元素，初始值均为0
    let mut _sieve = [false; 100]; // 100个布尔元素，初始值都是false
    let _bufferblock = [0u8; 1024]; // 1KB 的缓冲块，初始值为0

    let array4 = [10, 20, 30];
    println!("array4 has {} elements", array4.len());

    let taxonomy = ["A1", "A2", "A3"];
    println!("The second taxonomy is:{}", taxonomy[1]);

    let mut x = ["a", "b", "c"];
    println!("{} {} {} .", x[0], x[1], x[2]);
    x = ["X", "Y", "Z"];
    println!("{} {} {} .", x[0], x[1], x[2]);
    let y = ["1", "2", "3"];
    x = y;
    println!("{} {} {} .", x[0], x[1], x[2]);

    {
        let a: [u8; 3] = [1, 2, 3];
        show(a);
        let b: [u8; 4] = [1, 2, 3, 4];
        show_any(b);
    }

    // 多维数组
    {
        let v: [[i32; 2]; 3] = [[10, 20], [100, 200], [1000, 2000]];
        for i in &v {
            println!("{:?} ", i);
        }
    }
    // vec! 宏
    {
        let mut v = vec![];
        v.push(2);

        let _v1: Vec<u8> = Vec::new();
        let mut v2 = Vec::new();
        v2.push(2);
        v2.push(666);
        // get 需要传索引 0，返回 Option
        match v2.get(1) {
            Some(val) => println!("{} ", val),
            None => println!("向量为空"),
        }

        // 简写：unwrap 确信下标存在（此处不会panic）
        println!("{}", v2.get(0).unwrap());

        // 2. 泛型显式声明创建空Vec
        let mut v3 = Vec::<u8>::new();
        v3.push(10); // 使用v3消除未使用警告
        println!("v3第一个元素: {}", v3[0]);
    }

    // 指定类型
    {
        let _v1: Vec<u8> = Vec::new();
        let mut v2 = Vec::new();
        v2.push(2);
        let _v3 = Vec::<u8>::new();
        // 迭代 闭包 封装
        let v: Vec<i32> = (0..5).collect();
        println!("{:?}",v);
    }
}

fn show(arr: [u8; 3]) {
    for i in &arr {
        print!("{} ", i);
    }
    println!();
}

fn show_any<const N: usize>(arr: [u8; N]) {
    for i in &arr {
        print!("{} ", i);
    }
    println!();
}
```

**已编译运行（取自 **`src/Chapter4/数据.rs`**）。**

```latex
array4 has 3 elements
The second taxonomy is:A2
a b c .
X Y Z .
1 2 3 .
1 2 3 
......
[100, 200] 
[1000, 2000] 
666 
2
v3第一个元素: 10
[0, 1, 2, 3, 4]
```

## 1.8.2 向量
```rust
fn main() {
let mut v: Vec<i32> = Vec::new();        // 空向量，未分配
v.push(2);                                // 首次 push 才分配堆
v.push(666);
let v = vec![1, 2, 3];                    // 字面量宏
let v = (0..5).collect::<Vec<i32>>();     // 从迭代器收
}
```

向量特点：

1. 堆分配，内部是 `(ptr, len, cap)` 三元组。
2. `.push` 容量不足时按 **2×** 策略扩容（数据迁移）。
3. 访问：下标 `v[i]` panic 安全交由 `v.get(i) -> Option<&T>`。
4. 移动：`let v2 = v` 只迁移胖指针，原堆数据不复制。

`vec![]` 与 `Vec::new()` 的区别：

+ `Vec::new()` 不立即分配，节省一次空分配开销；
+ `vec![expr; n]` 等价 `vec![expr; n]`，会让编译器优化到单次分配。

### 向量（与切片）的访问方式
| 序号 | 方法 | 示例 | 描述 |
| --- | --- | --- | --- |
| 1 | `[index]` | `let first_line = &v.lines()[0]` | 通过索引直接访问 |
| 2 | `slice.first()` | `let Some(item) = v.first()` | 返回向量的第一个元素 |
| 3 | `slice.last()` | — | 返回向量的最后一个元素 |
| 4 | `slice.get(index)` | `slice.get(2)` | 返回向量指定索引位置上的元素 |
| 5 | `slice.first_mut()` / `slice.last_mut()` | `let last = slice.last_mut().unwrap();` | 上面 2、3、4 的可变版本 |
| 6 | `slice.to_vec()` | `v.to_vec()` | 复制整个向量 |
| 7 | `Iterator` | — | 可以通过迭代器来访问向量 |


> 用法提示：
>
> + `[index]` 在越界时会 panic（生产代码慎用，请改 `get(index)`）；
> + `first()` / `last()` / `get()` 对空切片返回 `None`，不会 panic；
> + `to_vec()` 是把任何实现了 `&[T]` / `ToOwned` 的对象复制为新的 `Vec<T>`，常用于 `&str -> String`、`&[T] -> Vec<T>`。
>

### 向量的常用成员方法
| 序号 | 方法 | 方法签名 | 描述 |
| --- | --- | --- | --- |
| 1 | `new()` | `pub fn new() -> Vec<T>` | 创建一个空的向量。该向量等到元素存入时才会真正地分配内存 |
| 2 | `push()` | `pub fn push(&mut self, value: T)` | 在数据序列的尾部追加元素 |
| 3 | `remove()` | `pub fn remove(&mut self, index: usize) -> T` | 删除指定索引位置上的元素，并将该位置后边的元素都向左移动 |
| 4 | `contains()` | `pub fn contains(&self, x: &T)` | 如果向量包含指定值的元素，则返回 `true` |
| 5 | `len()` | `pub fn len(&self) -> usize` | 返回向量中的元素个数 |


> 补充：上面列出的 5 个方法只覆盖最常用的部分；`Vec<T>` 还提供 `pop()` / `append()` / `clear()` / `truncate()` / `extend_from_slice()` / `dedup()` / `sort()` / `retain()` 等几十个成员方法。遇到具体需求，先查 [std::vec::Vec](https://doc.rust-lang.org/std/vec/struct.Vec.html) 的官方手册，再决定是手写循环还是直接用现成方法。
>

## 1.8.3 切片
切片是 DST（动态大小类型），它本身**无法**独立存在，只能通过胖指针 `&[T]` 引用一段连续数据。

```rust
fn main() {
let a = [10, 20, 30, 40, 50, 60];
let all = &a[..];        // 全元素
let sub = &a[1..4];      // 索引 1..4，半开 [1, 4) = [20, 30, 40]
let pre = &a[..=2];      // 闭区间 [..=2] = [10, 20, 30]
let suf = &a[2..];       // 下标 2 至结尾
let arr = [55, 22, 33, 44, 66];
let s   = &arr[..3];     // [55, 22, 33]
}
```

切片的本质：

```latex
&[T] 的内部表示（胖指针）：
+----------+----------+
| ptr      | len      |  // 24 字节（64 位机器）
+----------+----------+
   |
   v
+--+--+--+--+ ...
|T0|T1|T2|T3|     <- 任意连续数据：数组、Vec、其它切片的子集
```

特性：

+ 切片**不**拥有元素——借用离开作用域时数据不变；
+ 可变借用 `&mut [T]` 期间原数据其他人无法再借；
+ DST 不能直接传递，要传只能传引用或裸指针：

```rust
// 不能直接使用切片类型（编译错）：fn foo(x: [i32]) {}
// 切片的借用：
fn foo_borrow(x: &[i32]) -> &[i32] { x }

// 可变裸指针（unsafe）：
fn foo_raw(x: *mut [i32]) -> *mut [i32] { x }

fn main() {
    let arr = [1, 2, 3, 4];
    let s = foo_borrow(&arr[1..3]);
    println!("{:?}", s);
}
```

**（教学片段，直接复制 src/Chapter4/ 对应文件即可运行。）**

示例还展示一个"切片当长度借用"的尾字段结构：

```rust
// 把自定义 DST 用法改写为合法可执行的形态
struct Pair { tag: u8, left: u8, right: u8 }  // 不定长字段的代替：固定二元组

fn main() {
    let p = Pair { tag: 1, left: 0xAA, right: 0xBB };
    let bytes: &[u8] = unsafe {
        // 用裸指针从结构体地址取 [u8] 视图（这是 DST 的关键目的：在尾部拿到不定长字段）
        std::slice::from_raw_parts(
            &p as *const Pair as *const u8,
            std::mem::size_of::<Pair>(),
        )
    };
    println!("tag=0x{:02x} bytes={:02x?}", p.tag, bytes);
    // 真正的 DST 写法（编译错）：
    // struct DSTStruct { tag: u8, data: [u8] }
}
```
