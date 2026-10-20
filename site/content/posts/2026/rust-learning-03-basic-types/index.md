---
title: "1.2 基本数据类型"
author: cxi
date: 2026-10-20
tags: [ rust 类型 基础 ]
summary: "整型、布尔、字符、浮点类型的取值范围与内存表示。"
series:
  id: rust-learning
  title: "Rust 学习"
  order: 3
---

## 1.2.1 整型
Rust 的整型长度写进类型后缀：

| 长度 | 有符号 | 无符号 |
| --- | --- | --- |
| 8 | `i8` | `u8` |
| 16 | `i16` | `u16` |
| 32 | `i32`（默认） | `u32` |
| 64 | `i64` | `u64` |
| arch | `isize` | `usize` |


### 整数类型的范围
| 长度 | 无符号类型 | 范围 | 有符号类型 | 范围 |
| --- | --- | --- | --- | --- |
| 8-bit | `u8` | [0, 2⁸−1] = [0, 255] | `i8` | [−2⁷, 2⁷−1] = [−128, 127] |
| 16-bit | `u16` | [0, 2¹⁶−1] = [0, 65535] | `i16` | [−2¹⁵, 2¹⁵−1] = [−32768, 32767] |
| 32-bit | `u32` | [0, 2³²−1] | `i32` | [−2³¹, 2³¹−1] |
| 64-bit | `u64` | [0, 2⁶⁴−1] | `i64` | [−2⁶³, 2⁶³−1] |
| 128-bit | `u128` | [0, 2¹²⁸−1] | `i128` | [−2¹²⁷, 2¹²⁷−1] |
| 和架构相关 | `usize` | [0, 2³²−1] 或 [0, 2⁶⁴−1] | `isize` | [−2³¹, 2³¹−1] 或 [−2⁶³, 2⁶³−1] |


> **设计取舍**：
>
> + 无符号整型下界固定为 0，上界 2ⁿ−1；减法会自动饱和到 0（debug panic / release 回卷）。
> + 有符号整型跨"零"对称：负数下限 = −(2ⁿ⁻¹)，正数上限 = 2ⁿ⁻¹−1；这意味着 `i8` 范围是 [−128, 127] 而非 [−127, 128]，主要为了让 `|MIN| > |MAX|`，避开绝对值陷阱。
> + `usize` / `isize` 的具体宽度等于平台指针大小：在 32 位机器上是 32-bit，在 64 位机器上是 64-bit。下标、长度、`size_of` 全部用 `usize`，避免与地址宽度不匹配。
>

`usize` 是平台相关，**专用于下标、长度、内存大小**——`vec.len()`、`[i]` 索引、`size_of` 都是它。

### 整数溢出策略
`+`/`-`/`*` 在 **debug** 模式下溢出即 panic；**release** 下按补码回卷。`arithematic.rs` 给出 5 种显式 API：

| 方法 | 失败时 | 适用场景 |
| --- | --- | --- |
| `checked_*` | 返回 `None` | 业务禁止溢出也不能 panic（如金额、ID） |
| `wrapping_*` | 按位回卷 | 哈希、加密、位运算有意溢出 |
| `saturating_*` | 钳到 MIN/MAX | 信号处理、定点数 |
| `overflowing_*` | 返回 `(回卷值, 是否溢出bool)` | 既要结果又要审计 |
| 裸 `+/-/*` | debug panic / release 回卷 | 默认路径，不适合关键业务 |


### 各运算的命名后缀与样例
| 操作 | 名称后缀 | 示例 |
| --- | --- | --- |
| 加法 | `add` | `100_i8.checked_add(27) == Some(127)` |
| 减法 | `sub` | `10_u8.checked_sub(11) == None` |
| 乘法 | `mul` | `128_u8.saturating_mul(3) == 255` |
| 除法 | `div` | `64_u16.wrapping_div(8) == 8` |
| 余数 | `rem` | `(-32768_i16).wrapping_rem(-1) == 0` |
| 取负 | `neg` | `(-128_i8).checked_neg() == None` |
| 取绝对值 | `abs` | `(-32768_i16).wrapping_abs() == -32768` |
| 指数 | `pow` | `3_u8.checked_pow(4) == Some(81)` |
| 左位移 | `shl` | `10_u32.wrapping_shl(34) == 40` |
| 右位移 | `shr` | `40_u64.wrapping_shr(66) == 10` |


> 五个策略前缀（`checked_*` / `wrapping_*` / `saturating_*` / `overflowing_*` / 裸算符）与操作名后缀（`add`/`sub`/`mul`/...）两两正交，组合起来就是标准库全部"安全算符"矩阵。
>

```rust
fn main() {
// 示例：import std::Wrapping，整数包装类型，让 +/- 自动按回卷处理
use std::num::Wrapping;
let big = Wrapping(std::u32::MAX);
let sum = big + Wrapping(2_u32); // 不会 panic
}
```

布尔和整数严格分家：`false + true` 编译错，`true as u8 == 1`、`false as u8 == 0`，可做安全转换。

## 1.2.2 布尔类型
`bool` 两值 `true` / `false`，**不能与整数互算**。

| 运算 | 类型 |
| --- | --- |
| `== != < <= > >=` | 返回 `bool` |
| `&& ||` | 短路布尔（仅 `bool`） |
| `& | ^` | 按位布尔算符（仅 `bool`，不短路） |
| `as u8` | 显式把 `bool` 转成 `0/1` |


```rust
fn main() {
let b = false | true; // 不短路按位或
let s = false || true; // 短路逻辑或，常用于控制流
}
```

## 1.2.3 字符类型
`char` 是 **32 位 Unicode 标量***（不是单字节！），`'🦀'` 是一个合法字面量。占 4 字节。

```rust
fn main()
{
    // let _a = 'a' + 'b'; // 报错，非 C/C++ 数字类型
    println!("{} {} {}",'A' as u32,'🦉' as u32, 'E' as u32);
    println!("{}","\u{747e}\u{745c}");

    assert_eq!('*'.is_alphabetic(),false);
    assert_eq!('æ'.is_alphabetic(),true);
    assert_eq!('8'.to_digit(10),Some(8));
    assert_eq!('≠'.len_utf8(),3);
    assert_eq!(std::char::from_digit(2, 10),Some('2'));
}
```

**已编译运行（取自 **`src/Chapter4/char.rs`**）。**

```latex
65 129417 69
瑾瑜
```

注意：字符串用 `usize` 长度单位是**字节**，不是字符！

## 1.2.4 浮点类型
`f32` 与 `f64`（默认）遵循 IEEE 754：

+ `f32` ≈ 6~7 位十进制精度；`f64` ≈ 15~17 位。
+ 特殊值 `INFINITY`、`-INFINITY`、`NAN`、`-0.0`。
+ 严格区分正负零：`(-1.0 / INFINITY).is_sign_negative() == true`。

注意浮点**不精确**：

```rust
fn main() {
// 经典反直觉：float 不可 ==
assert!(0.1_f32 + 0.2_f32 == 0.3_f32); // 运气好可能成立，但跨平台不一致
// 更稳妥：用允许误差 fabs(a-b) < EPSILON
let abs = (0.3_f32 - (0.1_f32 + 0.2_f32)).abs();
assert!(abs <= f32::EPSILON);
}
```

实战中比较浮点：要么钳到相等，要么算**绝对误差**或**相对误差**。`EPSILON` 与 `INFINITY` 是按平台最优精度给出的常量。
