---
title: "HFT 系统基础：硬件到操作系统"
author: cshonor
date: 2026-10-20
tags: [ hft linux performance ]
summary: "NUMA、超线程与缓存金字塔对延迟的影响，以及操作系统抽象与编译器链接的代价。"
license: "CC BY 4.0"
series:
  id: hft-embedded-linux-14
  title: "HFT 工程实践"
  order: 4
---

## 4.1 NUMA、超线程与缓存金字塔

> 本地内存快、HT 引入 Jitter、连续内存命中缓存 — 硬件层三规则

HFT **通常不需定制机** — **现成 X86 服务器** + **配置与代码** 决胜负。

### NUMA（非统一内存访问）

```
Socket 0 ── local RAM ── CPU 0,1,…
    ╲
     ╲ QPI/UPI（跨 socket 慢）
    ╱
Socket 1 ── local RAM ── CPU …
```

| 规则 | 说明 |
|------|------|
| **本地内存快** | 访 **远端 socket** 内存 → **高延迟** |
| **HFT 设计** | **NIC 收包线程** 与 **网卡** 绑 **同一 NUMA node** |
| **工具** | `numactl --membind` · `lstopo` |

### 超线程（Hyper-threading）陷阱

- 硬件 **交替** 两逻辑核共享执行单元 → **吞吐↑**
- **牺牲** 软件对调度的控制 → **Jitter↑**
- **BIOS：关 HT** — 热点线程 **一物理核一线程**

### 缓存金字塔（Cache Hierarchy）

| 层级 | 典型 | 延迟量级 |
|------|------|----------|
| **L1I / L1D** | 每核私有 | 最快 |
| **L2** | 每核 |  |
| **L3** | 全核共享 |  |
| **RAM** | 相对 CPU **极慢** |  |

**Cache-friendly 代码：**

- **连续内存**（vector/ring）> 指针追逐链表
- **热数据结构** 控制在 **L1/L2 工作集**
- **False sharing** — 多线程改 **同一 cache line** → chapter-07

→ 15-computer-architecture · 09 MikanOS Ch8/19 分页

## 4.2 操作系统抽象的代价

> syscall 昂贵 · 上下文切换破坏缓存 · TLB miss · IRQ 打断 — 四大税

### User Space vs Kernel Space

| 空间 | 权限 | HFT 热点 |
|------|------|----------|
| **用户态** | 低 | Gateway / Book / Strategy |
| **内核态** | 高 — 控硬件 | **syscall 进出昂贵** |

每次 **`recv()`/`send()`** → **模式切换** + 内核协议栈 — 见 Ch5 **Kernel Bypass** 规避。

→ 03-linux-userspace-api · MikanOS Ch20 syscall

### 上下文切换（Context Switch）

OS 暂停线程 A、运行 B 时：

1. **保存** A 寄存器/状态
2. **加载** B 状态
3. **清空/污染** CPU 缓存 → B **冷启动 Cache Miss**

**对策：** **绑核 + isolcpus** — 热点线程 **独占核**，拒绝公平调度 → chapter-05

### 内存管理与大页（Huge Pages）

- **页表** 映射 VA→PA
- **TLB** 缓存映射 — **Miss** 则 **内存 walk**，极慢
- **4KB → 2MB/1GB 大页** — **TLB 覆盖更多内存** → 少 Miss

原理在此；挂载与 `nr_hugepages` → chapter-05

### 中断（Interruption）

网卡收包 → **硬件 IRQ** → **打断** 用户线程。

| 模式 | 特点 |
|------|------|
| **中断驱动** | 低负载友好 · **高 PPS 时 IRQ 风暴** |
| **NAPI / 轮询（DPDK/OpenOnload）** | 用户态 **poll** — 热点 **可预测** |

→ chapter-06 网络 · 13-DPDK

## 4.3 编译器与链接

> -O3 静态链接：编译期榨干，无 PLT 间接跳转

### 编译期优化

| 优化 | 作用 |
|------|------|
| **Loop unrolling** | 减分支与循环控制 |
| **Function inlining** | 消除 call 开销 · 助 **常量传播** |
| **LTO / -O3 -march=native** | 目标 CPU 指令集 |

**配合 C++：** 模板/CRTP 让 **多态在编译期** — chapter-08 编码规范

### 静态链接 vs 动态链接

| | **Static** | **Dynamic (.so)** |
|---|------------|-------------------|
| **部署** | 单二进制 | 共享库省磁盘 |
| **调用** | 直接地址 | **PLT 间接跳转** |
| **HFT** | **首选** — 跨库 **LTO** · 无运行时解析 |

```bash
## 示意
g++ -O3 -static -o gateway main.cpp ...
```

## 4.4 硬件选型速查（工程）

> CPU 单核频率 · BIOS 三关 · NIC 硬件时间戳 · FPGA 兜底

| 项 | 建议 |
|----|------|
| **CPU** | 高 **单核频率** · 少跨 NUMA |
| **BIOS** | 关 HT / Turbo / C-states |
| **NIC** | 硬件时间戳 · Bypass 生态（Solarflare/DPDK） |
| **FPGA** | 软件 **1–5 μs** 不够时 — ns 级确定性 |

### FPGA（纳秒级）

| 下沉 | 说明 |
|------|------|
| MD 解码 / 轻量 trigger | 无 OS 调度 |
| T2T | 可 **<500 ns** |

→ 深化：chapter-13 FPGA 与 Crypto（原书 Ch11） · chapter-01 FPGA

:::note 来源与许可
本文整理自 CShonor 的学习笔记仓库 [hft-embedded-linux-study](https://github.com/cshonor/hft-embedded-linux-study) 的 `14-hft-engineering` 模块（HFT 工程实践；该模块标注了与原书 Ch1–11 的对应关系，Ch10–13 为仓库自扩展章节），经作者授权以 CC BY 4.0 在本站署名发布。
:::

