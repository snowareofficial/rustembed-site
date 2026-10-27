---
title: "1.14 运算符"
author: cxi
date: 2026-10-20
tags: [ rust 运算符 ]
summary: "算术、比较、逻辑、位运算符以及运算符重载。"
series:
  id: rust-learning
  title: "Rust 学习"
  order: 15
---

参考 `arithematic.rs` 的 5 种策略。运算符分类：

| 类型 | 说明 |
| --- | --- |
| 一元 | `!`（按位非）、`-`（取负）、`*`（解引用）、`&`（取址）、`&mut`（取可变址） |
| 二元算术 | `+ - * / %` |
| 比较 | `== != < <= > >=` |
| 逻辑 | `&& ||` |
| 位运算 | `& | ^ << >>` |
| 复合赋值 | `+= -= *= /= %= &= |= ^= <<= >>=` |


### 一元操作符详表
| 操作符 | 操作符名 | 说明 |
| --- | --- | --- |
| `-` | 取负 | 专门用于数值类型 |
| `*` | 解引用 | 和 `Deref` / `DerefMut` 这个 trait 关联密切，类似于 C 语言里的指针取值 |
| `!` | 取反 | 对数字类型使用时，会将每一位全部置反；例：`!1u8` 结果为 `254u8` |
| `&` | 借用 | 向所有者租借只读使用权，生成不可变引用 |
| `&mut` | 借用 | 向所有者租借读写使用权，生成可变引用 |


> **关于"借用不是所有权的转移"**：
>
> + `&T` / `&mut T` 是胖指针：长度固定（与平台指针同宽）、**不夺走所有权**，作用域结束自动解租。
> + 同一数据同一时刻只能有**一个** `&mut T`（排他写），或**任意多个** `&T`（共享读）。这是借用检查器（borrow checker）的核心约束。
> + `*` 解引用之所以重要，是因为 `&T -> T` 的转换会自动调用 `Deref::deref(&T) -> &U`；`Box<T>`、`Rc<T>`、`String` 等都实现 `Deref`，所以 `(*my_box).field` 可以直接写成 `my_box.field`。
>

### 二元算术操作符
| 操作符 | 操作符名 | 说明 |
| --- | --- | --- |
| `+` | 加法 | 实现了 `std::ops::Add` |
| `-` | 减法 | 实现了 `std::ops::Sub` |
| `*` | 乘法 | 实现了 `std::ops::Mul` |
| `/` | 除法 | 实现了 `std::ops::Div` |
| `%` | 取余 | 实现了 `std::ops::Rem` |


> + 算术运算的具体溢出/回卷/钳制策略见 [1.2.1 整数溢出策略](#121-整型) 里的 5 种前缀（`checked_*` / `wrapping_*` / `saturating_*` / `overflowing_*` / 裸 `+/-/*`）。
> + 整型与浮点除法都按截断（向 0 取整）；要"四舍五入"得自己加半进位。
> + 二元运算符的实现机制：给目标类型 impl 对应 `std::ops::Xxx` 即可让 `a + b` 等表达式成立（细节见下面的 trait 速查表）。
>

### 位运算操作符
| 操作符 | 操作符名 | 说明 |
| --- | --- | --- |
| `&` | 与操作 | 实现了 `std::ops::BitAnd` |
| ` | ` | 或操作 |
| `^` | 异或 | 实现了 `std::ops::BitXor` |
| `<<` | 左移运算符 | 实现了 `std::ops::Shl` |
| `>>` | 右移运算符 | 实现了 `std::ops::Shr` |


> + 位运算在有/无符号整型上语义不同：算术（带符号）右移是 `shr`，但**左移**统一按逻辑移位（高位丢、低位补 0）。调试时要看清楚。
> + `&` / `|` / `^` 既是按位算符又是**短路**布尔算符（仅 `bool`）：`false | true` 不短路，`false || true` 短路。
> + 跟算术运算一样，移位也有 5 种策略（`checked_shl` / `wrapping_shl` / `saturating_shl` / `overflowing_shl` / 裸 `<<`）；32 位 `u32` 左移 ≥32 即未定义行为，但 `wrapping_shl` 会按模 N 自动回卷到合法位置。
> + 移位算符的实现 / 重载走 trait `BitAnd` / `BitOr` / `BitXor` / `Shl` / `Shr`，可与自定义结构体配合使用。
>

### 比较运算符
| 操作符 | 操作符名 | 说明 |
| --- | --- | --- |
| `==` | 等于 | 实现了 `std::cmp::PartialEq` |
| `!=` | 不等于 | 实现了 `std::cmp::PartialEq` |
| `<` | 小于 | 实现了 `std::cmp::PartialOrd` |
| `<=` | 小于或等于 | 实现了 `std::cmp::PartialOrd` |
| `>` | 大于 | 实现了 `std::cmp::PartialOrd` |
| `>=` | 大于或等于 | 实现了 `std::cmp::PartialOrd` |


> + `PartialEq` 与 `Eq` 不同：相等是"部分相等"（可以与 `NaN` 自反但 `NaN != NaN`），`Eq` 表示全等（等价关系 + 自反）。自定义类型用 `derive(PartialEq)` 即可；要求等价关系的额外写 `derive(Eq)`。
> + `PartialOrd` 与 `Ord` 类似：`PartialOrd` 允 `NaN`-style 不可比；`Ord` 是全序。常用 `derive(PartialOrd, Ord)`。
> + Rust 写 `==` / `!=` / `<` / `>` 这些算符时，编译器都会自动引用相应 trait 里的方法（`eq`、`lt`、`gt` 等），所以只要 `derive` 或 `impl` 一次，整个类型就都能用了。
>

### 运算符对应的 trait（实现 trait 即可重载）
| 类别 | Trait | 运算符 |
| --- | --- | --- |
| 一元操作符 | `std::ops::Neg` | `-x` |
|  | `std::ops::Not` | `!x` |
| 算术操作符 | `std::ops::Add` | `x + y` |
|  | `std::ops::Sub` | `x - y` |
|  | `std::ops::Mul` | `x * y` |
|  | `std::ops::Div` | `x / y` |
|  | `std::ops::Rem` | `x % y` |
| 位操作符 | `std::ops::BitAnd` | `x & y` |
|  | `std::ops::BitOr` | `x | y` |
|  | `std::ops::BitXor` | `x ^ y` |
|  | `std::ops::Shl` | `x << y` |
|  | `std::ops::Shr` | `x >> y` |
| 复合算术赋值运算符 | `std::ops::AddAssign` | `x += y` |
|  | `std::ops::SubAssign` | `x -= y` |
|  | `std::ops::MulAssign` | `x *= y` |
|  | `std::ops::DivAssign` | `x /= y` |
|  | `std::ops::RemAssign` | `x %= y` |
| 复合位操作赋值 | `std::ops::BitAndAssign` | `x &= y` |
|  | `std::ops::BitOrAssign` | `x |= y` |
|  | `std::ops::BitXorAssign` | `x ^= y` |
|  | `std::ops::ShlAssign` | `x <<= y` |
|  | `std::ops::ShrAssign` | `x >>= y` |
| 比较 | `std::cmp::PartialEq` | `x == y`, `x != y` |
|  | `std::cmp::PartialOrd` | `x < y`, `x <= y`, `x > y`, `x >= y` |
| 索引 | `std::ops::Index` | `x[y]` |
|  | `std::ops::IndexMut` | `x[y] = z`, `&mut x[y]` |


> 这些 trait 全在 `std::ops` / `std::cmp` 里，**实现对应 trait 即可让自定义类型也用运算符**：
>
> 实现 `PartialEq` 自动得到 `==` 与 `!=`（Rust 写 `==` 自动 deref 到 `PartialEq::eq`）；`PartialOrd` 给 `derive(PartialOrd, Ord)` 即可。完整示例见 [src/Chapter4/impl代码块.rs](/Volumes/CX/学习/Rust/helloworld/src/Chapter4/impl代码块.rs) 里的 `impl Mul for Point { ... }`。
>

```rust
use std::ops::Add;
struct Point { x: i32, y: i32 }
impl Add for Point {
    type Output = Point;
    fn add(self, other: Point) -> Point { Point { x: self.x + other.x, y: self.y + other.y } }
}
```

### 运算符优先级（高 → 低）
| 运算符 | 结合性 |
| --- | --- |
| 字段访问、方法调用、数组索引 `x.y` / `x.method()` / `x[i]` | 从左至右 |
| `?`（错误传播） | — |
| 一元运算符（`-`、`*`、`!`、`&`、`&mut`） | 从右至左 |
| `as`（类型转换） | — |
| 二元乘除（`*`、`/`、`%`） | 从左至右 |
| 二元加减（`+`、`-`） | 从左至右 |
| 移位（`<<`、`>>`） | 从左至右 |
| 按位与 `&` | 从左至右 |
| 按位异或 `^` | 从左至右 |
| 按位或 `|` | 从左至右 |
| 比较（`==`、`!=`、`<`、`>`、`<=`、`>=`） | 需要括号 |
| 逻辑与 `&&` | 从左至右 |
| 逻辑或 `||` | 从左至右 |
| 范围（`..`、`..=`） | 需要括号 |
| 赋值（`=`、`+=`、`-=`、`*=`、`/=`、`%=`、`&=`、`|=`、`^=`、`<<=`、`>>=`） | 从右至左 |
| `return`、`break`、闭包 ` | … |


> **判断口诀**：读写优先级时，从上往下"逐渐降低"；同级别多个算符连写时，再看行的结合性（"从左至右"还是"从右至左"）。`比较`、单 `?`、`return` 等"非结合"算符要求显式括号，避免读代码时产生歧义。
>
