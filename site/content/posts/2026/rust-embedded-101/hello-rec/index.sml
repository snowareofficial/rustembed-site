title: "从零点亮一块板子：probe-rs + Rust 的第一步"
author: sal
date: 2026-09-19
updated: 2026-09-19
map: true
tags: [ rust embedded probe-rs ]
summary: "不讲大道理，先把程序烧进去：probe-rs 安装、连接、烧录、打日志的完整最小路径。"
license: "CC BY-NC-SA 4.0"
series { id: "rust-embedded-101" order: 1 }
video: "BV1GJ411x7h7"

body: [
  topic 为什么从工具链讲起 {
    children: [
      para { text: "嵌入式 Rust 的第一道坎通常不是语言，而是「怎么把东西弄进去」。这篇只走一条能跑通的路：{em: 装工具 → 连上 → 烧录 → 看日志}。" }
      note { text: "下文以常见的 Cortex-M 调试探针为例，其它芯片换 target 即可。" }
    ]
  }

  section 安装 {
    label: "setup"
    children: [
      para { text: "只需要一个命令：" }
      code { lang: bash text: "cargo install probe-rs-tools --locked\nrustup target add thumbv7em-none-eabihf" }
      para { text: "装完用 {em: probe-rs list} 确认探针被识别；看不到设备先查驱动，不要先怀疑代码。" }
    ]
  }

  section 烧录与日志 {
    label: "flash"
    children: [
      para { text: "进到工程目录执行：" }
      code { lang: bash text: "cargo run --release" }
      para { text: "若已在 {em: .cargo/config.toml} 里配好 runner，这一步会直接烧录并打开 RTT 日志。没有 RTT 时改用：" }
      code { lang: bash text: "probe-rs run --chip STM32F407VG target/thumbv7em-none-eabihf/release/app" }
      quote { text: "工具链的复杂度是一次性成本，跑通一次之后都是复利。" }
    ]
  }

  section 常见坑 {
    label: "pitfalls"
    children: [
      ul {
        items: [
          "探针固件过旧：升级后再试"
          "芯片被读保护：先解除保护"
          "连上了但下不进去：确认 target 三元组与芯片型号匹配"
        ]
      }
    ]
  }
]

attachments: [
  { name: "示例工程" kind: link url: "https://gitee.com/rustembed/site" size: "—" }
]
