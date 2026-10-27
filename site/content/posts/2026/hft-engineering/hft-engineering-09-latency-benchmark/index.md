---
title: "延迟测量与基准压测"
author: cshonor
date: 2026-10-20
tags: [ hft performance linux ]
summary: "内核旁路与 mmap、跨数据中心链路、异步日志，以及怎样把延迟测准而不是测出漂亮数字。"
license: "CC BY 4.0"
series:
  id: hft-engineering
  title: "HFT 工程实践"
  order: 9
---

## 9.1 内核旁路 (Kernel Bypass)

> 用户态直接 poll NIC ring — 无阻塞、无 IRQ 等待、无 memcpy

← 上一章：chapter-08 C++ 引擎 · 下一节：9.2 mmap 与 IPC

### 传统路径的代价

用户态程序 ↔ **syscall/IRQ** ↔ 内核 ↔ NIC — chapter-06 §4 数据包生命周期：

- **上下文切换**
- **sk_buff 分配 · 头部分解 · socket 队列 · 拷贝**

### Bypass 核心

| 机制 | 说明 |
|------|------|
| **User-space spinning** | 交易线程 **100% poll** NIC ring — **无阻塞 · 无 IRQ 等待** |
| **Zero copy** | DMA 数据 **映射/直达** 用户缓冲 — **无 memcpy** |

| 产品（示例） | |
|--------------|---|
| **OpenOnload** | Solarflare / AMD |
| **VMA** | Mellanox / NVIDIA |
| **DPDK** | 通用 PMD |

**效果（书中量级）：** UDP/TCP 读写 **1.5–10 μs → 0.5–2 μs**。

→ 实操 chapter-05 §3 Kernel Bypass · 13-DPDK

← 下一节：9.2 mmap 与 IPC · 返回：本章索引

## 9.2 内存映射文件 (mmap) 与 IPC

> /dev/shm + 无锁环 — Gateway ↔ Strategy 零拷贝跨进程

← 上一节：9.1 Kernel Bypass · 下一节：9.3 微波与空芯光纤

```cpp
void* addr = mmap(nullptr, size, PROT_READ|PROT_WRITE,
                   MAP_SHARED, fd, 0);
```

| 用途 | HFT |
|------|-----|
| **持久化** | 大文件 **随机访问** 快于 read/write 循环 |
| **非持久化 IPC** | **`/dev/shm` 或 memfd** + **无锁环** — Gateway ↔ Strategy **零拷贝** |

**模式：**

```
进程 A 写 ring slot → 进程 B acquire/release
共享区 = mmap 的同一块物理页
```

→ chapter-07 §2 无锁环 · 03-linux-userspace-api mmap

← 下一节：9.3 微波与空芯光纤 · 返回：本章索引

## 9.3 跨数据中心：微波与空芯光纤

> 空气光速比玻璃快 ~50% — 芝加哥 ↔ 纽约买的是物理定律

← 上一节：9.2 mmap 与 IPC · 下一节：9.4 异步日志

| 介质 | 特点 |
|------|------|
| **Microwave** | 空气光速 **> 玻璃 ~50%** · **直线** · **最快** · **带宽低 · 天气敏感** |
| **Hollow fiber** | 芯内 **空气通道** · 快于实心光纤 · 常接 **DC ↔ 微波塔**（数百码） |

**场景：** 芝加哥 ↔ 纽约 **latency arbitrage** — 与 chapter-03 §4 共址 **互补**（机柜内 μs vs 城际 ms）。

→ chapter-06 §6 广域链路

← 下一节：9.4 异步日志 · 返回：本章索引

## 9.4 移出关键路径：异步日志

> printf + sync 写盘 = ms 级阻塞 — 热点只许 memcpy 一个 POD

← 上一节：9.3 微波与空芯光纤 · 下一节：9.5 精确测量与基准压测

### 为何同步日志致命

| 操作 | 问题 |
|------|------|
| **`printf` / fmt** | 字符串格式化 **慢** |
| **sync 写盘** | **ms 级** · 可能 **阻塞** |

**热点路径禁止同步日志。**

### 异步架构

```
Critical Path                    Background Core
─────────────                    ───────────────
binary event ──► lock-free ring ──► Logger thread
  (POD, 固定大小)                      │
                                       ├─ 格式化
                                       └─ 批量 fsync
```

| 要点 | 说明 |
|------|------|
| **二进制 blob** | 热点只 **memcpy 固定 struct** |
| **无锁环** | chapter-07 |
| **专属核** | Logger **不抢** Gateway/Strategy 核 |
| **mmap 缓冲** | 可选 **环形文件映射** 批量刷盘 |

**原则：** 格式化与磁盘 I/O **永不** 在 T2T 路径上执行。

← 下一节：9.5 精确测量与基准压测 · 返回：本章索引

## 9.5 精确性能测量与基准测试

> 消不掉 jitter 就测不出 p99 — T2T 是终极指标

← 上一节：9.4 异步日志 · 返回：本章索引

### 消除非确定性（测前必做）

| 层 | 关闭/固定 |
|----|-----------|
| **BIOS** | Turbo · HT · C-states |
| **OS** | **ASLR**（基准时可关）· 无关 IRQ |
| **负载** | **isolcpus** 与生产一致 |

否则 **p99 不可复现** — 优化无从谈起。

→ chapter-05 · chapter-04 §2

### 时间戳工具

| 工具 | 说明 |
|------|------|
| **`gettimeofday`** | 常 **syscall** — 测微基准 **慎用** |
| **`rdtsc` / `rdtscp`** | CPU 周期 — **inline** · 需 **频率校准/invariant TSC** |
| **`std::chrono::high_resolution_clock`** | C++11 · 实现可能仍 syscall — **benchmark 验证** |
| **NIC PHC 硬件戳** | **TTT 金标准** — chapter-06 §5 PTP |

```cpp
inline uint64_t rdtsc() {
    unsigned hi, lo;
    __asm__ volatile("rdtsc" : "=a"(lo), "=d"(hi));
    return ((uint64_t)hi << 32) | lo;
}
```

### 端到端 Tick-to-Trade (TTT / T2T)

**终极指标：** 行情进 NIC → 订单出 NIC。

```
t1  NIC RX hardware timestamp
t2  Gateway parse out
t3  Book update done
t4  Strategy signal
t5  OMS risk pass
t6  Gateway OUT serialize
t7  NIC TX submit
…
T2T = t7 - t1
```

| 实践 | 说明 |
|------|------|
| **每 hop 探针** | 定位 **瓶颈组件** |
| **p50/p99/p999** | 尾延迟 · 非仅平均 |
| **Replay 压测** | 生产 pcap **离线** — chapter-01 §8 实战 |
| **探针开销** | 测量工具 **本身** 要 **inline / 采样** |

→ 06.6-Systems-Performance

返回：本章索引

:::note 来源与许可
本文整理自 CShonor 的学习笔记仓库 [hft-embedded-linux-study](https://github.com/cshonor/hft-embedded-linux-study) 的 `14-hft-engineering` 模块（HFT 工程实践；该模块标注了与原书 Ch1–11 的对应关系，Ch10–13 为仓库自扩展章节），经作者授权以 CC BY 4.0 在本站署名发布。
:::

