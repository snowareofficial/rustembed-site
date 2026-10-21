---
title: "编译教学"
author: cxi
date: 2026-10-20
tags: [ rust 编译 入门 ]
summary: "从 cargo new 到 rustc 编译可执行文件和静态库，快速过一遍 Rust 工程与编译流程。"
series:
  id: rust-learning
  title: "Rust 学习"
  order: 1
---

## 创建工程
```rust
cargo new helloworld --bin
```

![项目工程文件结构](assets/project-layout.png)



## 单rust编译为可执行
```rust
fn main() {
    // println!("Hello, world!");
    if cfg!(sayhello){
        println!("Hello Milly!");
    }
}
```

cfg! 指定编译！ 编译指令

```bash
caixian@CXi-Mac helloworld % cd src
caixian@CXi-Mac src % rustc --cfg sayhello main.rs 
caixian@CXi-Mac src % ./main
Hello Milly!
caixian@CXi-Mac src % 
```



## 编译为静态库
![静态库项目结构](assets/static-lib.png)

```rust
pub fn print_hello()
{
    println!("Hello this is Lib!");
}
```

```rust
extern crate myhello;

fn main() {
    // println!("Hello, world!");
    if cfg!(sayhello){
        println!("Hello Milly!");
    }
    myhello::print_hello();
}
```

```bash
rustc --crate-type lib myhello.rs  # 编译为静态库
rustc -L. -lmyhello main.rs	# 编译为 可执行程序
rustc -L. -lmyhello --cfg sayhello main.rs # 添加标志
```
