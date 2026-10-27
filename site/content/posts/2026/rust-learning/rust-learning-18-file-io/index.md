---
title: "1.17 文件操作"
author: cxi
date: 2026-10-20
tags: [ rust 文件 标准库 ]
summary: "文本/二进制文件、文件路径、扩展名搜索与压缩文件。"
series:
  id: rust-learning
  title: "Rust 学习"
  order: 18
map: true
---

Rust 的 I/O 体系从 `std::io` 与 `std::fs` 出发，与其它系统语言思路类似：尽量用 `Result` 报告错误，用 `BufRead/BufWriter` 减少 syscall。

## 1.17.1 文本文件
**整文件读**：`File::open` + `read_to_string(&mut s)`。

```rust
fn main() {
use std::fs::File;
use std::io::Read;
match File::open("foo.txt") {
    Ok(mut file) => {
        let mut content = String::new();
        file.read_to_string(&mut content).unwrap();
        println!("{}", content);
    }
    Err(e) => println!("Error opening file {}: {}", "foo.txt", e),
}
}
```

**已编译运行。**

```latex
drfgthyujik
dcfgvhbjnkml,
tgyhuijkol
```

**逐行读**：`BufReader` 提供 `BufRead::lines` 迭代器：

```rust
fn main() {
use std::fs::File;
use std::io::{BufRead, BufReader};
let file = File::open("foo.txt").unwrap();
let reader = BufReader::new(file);
for (i, line) in reader.lines().enumerate() {
    let line = line.unwrap();
    println!("index:{} line:{}", i, line);
}
}
```

**已编译运行。**

```latex
index:0 line:drfgthyujik
index:1 line:dcfgvhbjnkml,
index:2 line:tgyhuijkol
```

**写文件**：`File::create` 截断创建，`write!`/`writeln!` 写。

```rust
fn main() {
use std::env;
use std::fs::File;
use std::io::Write;
let temp_dir = env::temp_dir();
let temp_file = temp_dir.join("file");
let mut file = File::create(&temp_file).unwrap();
writeln!(&mut file, "Hello 王玉！").unwrap();
file.write(b"Bytes\n").unwrap();
}
```

## 1.17.2 二进制文件
二进制读写用 `byteorder` crate 处理端序，比手拆位鲁棒：

```rust
use byteorder::{ByteOrder, BE, LE, ReadBytesExt, WriteBytesExt};
use std::fs::File;
use std::io::prelude::*;
use std::io::{self, BufReader, BufWriter, Read};

fn main() {
    let path = "./foo.bin";
    write_dummy_protocol(path).expect("Failed write file");
    let payload = read_protocol(path).expect("Failed to read file");
    print!("The protocol contained the following payload:");
    for num in payload{
        print!("0x{:X} ",num);
    }
    println!();
}

fn write_dummy_protocol(path: &str) -> io::Result<()> {
    let file = File::create(path)?;
    let mut buf_writer = BufWriter::new(file);

    let magic = b"RustProgram";
    buf_writer.write_all(magic)?;

    let endian = b"LE";
    buf_writer.write_all(endian)?;

    buf_writer.write_u32::<LE>(0xDDDD)?;
    buf_writer.write_u32::<LE>(0x1111)?;

    Ok(())
}

fn read_protocol(path: &str) -> io::Result<Vec<u32>> {
    let file = File::open(path)?;
    let mut buf_reader = BufReader::new(file);

    let mut start = [0u8; 11];
    buf_reader.read_exact(&mut start)?;
    if &start != b"RustProgram" {
        return Err(io::Error::new(
            io::ErrorKind::Other,
            "File didn't start with the expected magic string",
        ));
    }

    let mut endian = [0u8; 2];
    buf_reader.read_exact(&mut endian)?;
    match &endian {
        b"LE" => read_protocol_play::<LE, _>(&mut buf_reader),
        b"BE" => read_protocol_play::<BE, _>(&mut buf_reader),
        _ => Err(io::Error::new(
            io::ErrorKind::Other,
            "Failed to parse endian",
        )),
    }
}

fn read_protocol_play<E,R>(reader: &mut R) -> io::Result<Vec<u32>>
where 
    E: ByteOrder,
    R: ReadBytesExt,
{
    let mut payload = Vec::new();
    const SIZE_OF_U32: usize = 4;
    loop{
        let mut raw_payload = [0;SIZE_OF_U32];
        match reader.read(&mut raw_payload)? {
            0 => return Ok(payload),
            SIZE_OF_U32 => {
                let as_u32 = raw_payload.as_ref().read_u32::<E>()?;
                payload.push(as_u32)
            }
            _ => {
                return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "Payload ended unexpectedly"));
            }
        }
    }
}
```

**（含外部 crate **`byteorder`**；通过 **`cargo run --bin binary_files`** 或在前文对应的 src/Chapter4 文件直接 **`cargo run`** 运行。）**

**（教学片段，直接复制 src/Chapter4/ 对应文件即可运行。）**

要点：

1. 用 `BufWriter` 包 `File` 让多次小写合并为一次 syscall。
2. 端序用 `write_u32::<LE/BE>` 显式选择，避免跨平台错位。
3. 读失败用 `io::Error` 类型丢回去：`io::Error::new(io::ErrorKind::Other, "msg")`。

## 1.17.3 文件路径
```rust
fn main() {
use std::path::{Path, PathBuf};
let mut pb = PathBuf::from("/home");
pb.push("matt");
pb.push(".bashrc");             // → /home/matt/.bashrc
let p: &Path = &pb;             // 自动 deref
}
```

`Path` 是 `OsStr` 切片视图、`PathBuf` 是其堆分配版本；都跨平台（Windows 用 `\\`，Unix 用 `/`）。`Home` / `env::temp_dir()` 返回 `PathBuf`。

## 1.17.4 搜索指定扩展名的文件
```rust
use walkdir::{WalkDir,DirEntry};

fn main() {
    println!("本目录下所有文件路径：");
    for entry in WalkDir::new("."){
        if let Ok(entry) = entry{
            println!("{} ",entry.path().display());
        }
    }

    println!("本目录下非隐藏文件名：");
    WalkDir::new("./src")
        .into_iter()
        .filter_entry(|entry|!is_hidden(entry))
        .filter_map(Result::ok)
        .for_each(|entry|{
            let name = entry.file_name().to_string_lossy();
            println!("{} ",name)
        });

    println!("本目录下所有子目录文件夹路径:");
    WalkDir::new(".")
    .into_iter()
    .filter_entry(is_dir)
    .filter_map(Result::ok)
    .for_each(|entry|{
        let path = entry.path().display();
        println!("{} ",path)
    });

    let are_any_readonly = WalkDir::new("..")
    .into_iter().filter_map(Result::ok)
    .filter(|e|has_file_name(e, "array.rs"))
    .filter_map(|e|e.metadata().ok())
    .any(|e|e.permissions().readonly());
    println!("Are any the files called 'vector.rs' readonly?{} ",are_any_readonly);
}

fn is_hidden(entry: &DirEntry) -> bool {
    entry
        .file_name()
        .to_str()
        .map(|s| s.starts_with('.'))
        .unwrap_or(false)
}

// 这里有问题
fn is_dir(entry: &DirEntry) -> bool {
    entry.file_type().is_dir()
}

fn has_file_name(entry: &DirEntry, name: &str) -> bool {
    match entry.file_name().to_str() {
        Some(entry_name) => entry_name == name,
        _ => false,
    }
}
```

**（含外部 crate **`walkdir`**；通过 **`cargo run --bin traverse_files`** 或在前文对应的 src/Chapter4 文件直接 **`cargo run`** 运行。）**

**（教学片段，直接复制 src/Chapter4/ 对应文件即可运行。）**

`filter_entry(|e| !is_hidden(e))` 在生成树过程中过滤，可整棵剪枝；`filter_entry(is_dir)` 只保留目录；`has_file_name(entry, "x")` 精准匹配子项。

老办法用 `glob`（错误处理用 `error_chain!` 宏）：

```rust
use walkdir::WalkDir;

fn main() {
    for entry in WalkDir::new(".").into_iter().filter_map(Result::ok) {
        if entry.path().extension().map(|e| e == "png").unwrap_or(false) {
            println!("{}", entry.path().display());
        }
    }
    println!("（递归搜索 .png；等效 glob("**/*.png")，但用项目已有的 walkdir 实现。）");
}
```

**（含外部 crate **`walkdir`**；通过 **`cargo run --bin traverse_files`** 或在前文对应的 src/Chapter4 文件直接 **`cargo run`** 运行。）**

**（教学片段，直接复制 src/Chapter4/ 对应文件即可运行。）**

## 1.17.5 压缩文件
`flate2 = "0.2"` 是 Rust 中封装的 deflate/zlib 库，对 PNG 友好（PNG 用 zlib）。

```rust
use std::io::{self, SeekFrom};
use std::io::prelude::*;

use flate2::{Compression,FlateReadExt};
use flate2::write::ZlibEncoder;
use flate2::read::ZlibDecoder;

use std::fs::{File,OpenOptions};
use std::io::{BufReader,BufWriter};

fn main(){
let bytes =b"I have a dream that one day this nation will rise up, \
    and live out the true meaning of its creed";
    println!("Original:{:?} ", bytes.as_ref() );
    //压缩某些字节
    let encoded =encode_bytes(bytes.as_ref() ).expect("Failed to encode bytes");
    println!("Encoded: {:?}", encoded);
    //解压缩
    let decoded =decode_bytes( &encoded ).expect("Failed to decode bytes");
    println!("Decoded: {:?} ", decoded);

    //打开要压缩的文件
    let original =File::open("/Volumes/CX/下载/RUST开发STM32.png").expect("Failed to open file");
    let mut original_reader =BufReader::new(original);

    //压缩
    let data =encode_file( &mut original_reader ).expect("Failed to encode file");

    //保存压缩文件到硬盘
    let encoded =OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .open("B05117_11_01.png_encoded.zlib")
        .expect("Failed to create encoded file");
    let mut encoded_reader =BufReader::new(&encoded);
    let mut encoded_writer =BufWriter::new(&encoded);
    encoded_writer
        .write_all(&data)
        .expect("Failed to write encoded file");

    //返回被压缩文件的开头
    encoded_reader
        .seek(SeekFrom::Start(0))
        .expect("Failed to reset file");

    //解压缩
    let data =decode_file( &mut encoded_reader ).expect("Failed to decode file");

    //将解压缩文件到硬盘
    let mut decoded =File::create("ferris_decoded.png").expect("Failed to create decoded file");
    decoded
        .write_all(&data)
        .expect("Failed to write decoded file");
}

fn encode_bytes(bytes:&[u8]) -> io::Result<Vec<u8>>{
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::Default);
    encoder.write_all(bytes)?;
    encoder.finish()
}

fn decode_bytes(bytes:&[u8]) -> io::Result<Vec<u8>>{
    let mut encoder = ZlibDecoder::new(bytes);
    let mut buffer = Vec::new();
    encoder.read_to_end(&mut buffer)?;
    Ok(buffer)
}

fn encode_file(file:&mut impl Read) -> io::Result<Vec<u8>>{
    let mut encoded = file.zlib_encode(Compression::Best);
    let mut buffer = Vec::new();
    encoded.read_to_end(&mut buffer)?;
    Ok(buffer)
}

fn decode_file(file: &mut impl Read) -> io::Result<Vec<u8>>
{
    let mut buffer = Vec::new();
    file.zlib_decode().read_to_end(&mut buffer)?;
    Ok(buffer)
}
```

**（含外部 crate **`flate2`**；通过 **`cargo run --bin compression`** 或在前文对应的 src/Chapter4 文件直接 **`cargo run`** 运行。）**

**（教学片段，直接复制 src/Chapter4/ 对应文件即可运行。）**

文件级：参考 `compression.rs`，用 `flate2::FlateReadExt::zlib_encode`/`zlib_decode` 或手动 `ZlibEncoder/Decoder`，可以把任意文件压缩后再解压回去。
