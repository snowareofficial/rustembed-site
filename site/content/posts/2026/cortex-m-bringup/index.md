---
title: "From a Blank Board to RTT: A Cortex-M Bring-Up Field Note"
author: sal
date: 2026-10-19
tags: [rust, embedded, probe-rs, walkthrough]
summary: "A weekend bring-up log: toolchain, wiring, first flash, RTT, and the checks that save an afternoon."
map: true
---

Most embedded Rust tutorials end at `cargo build`. The interesting part starts after that: the probe enumerates, the target answers, and the first log line appears. This note is a condensed record of a weekend bring-up — the commands that worked, the wiring mistakes that did not, and the small checks that turn a silent board into a readable one.

It assumes you already have a Cortex-M board, a debug probe (ST-Link, J-Link, or a CMSIS-DAP clone), and a `cargo` installation. Nothing here is board-specific except the chip name; replace it with yours and the rest of the flow stays the same.

## What you actually need

- a board with a Cortex-M MCU and a exposed SWD header;
- a probe that `probe-rs` supports;
- four jumper wires: `SWDIO`, `SWCLK`, `GND`, and the target's logic voltage;
- a USB cable that carries data, not just power.

The last point deserves a sentence of its own. A surprising number of "dead boards" are charging cables with no data lines. If the probe never appears in `probe-rs list`, try a different cable before you try a different probe.

## Toolchain in three commands

```bash
cargo install probe-rs-tools --locked
rustup target add thumbv7em-none-eabihf
probe-rs list
```

The target name depends on your core. `thumbv6m-none-eabi` covers Cortex-M0/M0+, `thumbv7m-none-eabi` covers M3, and `thumbv7em-none-eabihf` covers M4F/M7F. When in doubt, check the datasheet, not a blog post.

A healthy `probe-rs list` prints one line per connected probe:

```text
[0]: STLink V2-1 (VID: 0483, PID: 374b, Serial: 066EFF..., StLink)
```

If the list is empty, stop here. No amount of firmware debugging will help until the host can see the probe.

## Wiring, slowly

| Probe pin | Target pin | Why it matters |
|---|---|---|
| SWDIO | SWDIO | bidirectional data; a loose wire produces intermittent IDs |
| SWCLK | SWCLK | clock; keep it short if the target is noisy |
| GND | GND | the reference for every other signal |
| 3V3 | VDD (logic) | must match the target's I/O voltage |
| NRST | NRST (optional) | lets the probe reset the core deterministically |

Two rules prevent most damage: **never connect 5 V to a 3.3 V target**, and **connect ground before signal wires**. If the board is self-powered, leave the probe's 3V3 pin unconnected and only share ground — unless you have checked that back-powering is safe for your particular board.

## First contact

With the probe visible, ask it what is on the other end:

```bash
probe-rs info --chip STM32F411CEUx
```

A correct answer includes the core type, the target voltage, and the flash size. A timeout usually means wiring, a held reset, or a target that is sleeping in a low-power mode. A wrong ID usually means the chip name is wrong — vendors love near-identical part numbers.

## Flash and run

The shortest path is to let the probe act as Cargo's runner. Pin it once in `.cargo/config.toml`:

```toml
[target.thumbv7em-none-eabihf]
runner = "probe-rs run --chip STM32F411CEUx"
```

After that, `cargo run --release` flashes and starts the firmware. The first successful run is usually anticlimactic: a few lines of output, then nothing, because the program is sitting in a loop. That is exactly what you want.

## RTT instead of a serial port

Many boards have no spare UART, and a USB-serial adapter is one more thing to lose. RTT (Real-Time Transfer) uses a small ring buffer in target RAM; the probe reads it while the CPU keeps running. With `rtt-target`, the firmware side looks like this:

```rust
#![no_std]
#![no_main]

use cortex_m_rt::entry;
use panic_halt as _;
use rtt_target::{rprintln, rtt_init_print};

#[entry]
fn main() -> ! {
    rtt_init_print!();
    rprintln!("boot: 72 MHz, 3.3 V");
    loop {}
}
```

The exact command for reading the buffer depends on the `probe-rs` version; `probe-rs run` and `probe-rs attach` are the two entry points you will use. The important part is that logging becomes a memory write, not an interrupt-driven UART transaction, so timing-sensitive code stays timing-sensitive.

## When nothing works

| Symptom | Likely cause | Check |
|---|---|---|
| `probe-rs list` empty | cable, driver, or permissions | another cable; device manager; udev rules on Linux |
| probe found, target timeout | wiring or reset | continuity on SWDIO/SWCLK/GND; release NRST |
| target ID mismatch | wrong chip name | datasheet part number, not the board name |
| flash succeeds, no logs | RTT not initialized | `rtt_init_print!()` before the first `rprintln!` |
| logs appear once, then stop | buffer overflow or panic | larger RTT buffer; check the panic handler |

The most useful habit is to change one variable at a time. Swap the cable, rerun `probe-rs list`; fix the wiring, rerun `probe-rs info`; then flash. A bring-up session with three simultaneous changes teaches you nothing.

## What I would do differently

I would write the wiring table before touching the board, and I would keep a known-good probe and cable in a separate bag. Most of the afternoon went into a cable that charged a phone perfectly and carried no data at all. The second biggest win was pinning the chip name in `.cargo/config.toml`, which removed a whole class of copy-paste mistakes.

## 中文备注

这篇刻意把英文比例调高，用来检查正文的英文排版：Times New Roman 下的数字、单位（12.8 ms、3.3 V、25 °C）、引号和连字符是否比 MiSans 更整齐；中文仍由 MiSans 子集渲染。技术内容按一次真实的 Cortex-M 烧录与 RTT 日志流程写成，换芯片时只需改 target 和 chip 参数。
