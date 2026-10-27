---
title: "低延迟网络与协议优化"
author: cshonor
date: 2026-10-20
tags: [ hft network performance ]
summary: "交换机与网卡硬件、TCP 与 UDP 的取舍、金融应用层协议与数据包的内核路径。"
license: "CC BY 4.0"
series:
  id: hft-engineering
  title: "HFT 工程实践"
  order: 6
---

## 6.1 网络硬件与交换机

> 机柜内延迟 = 交换机模式 + NIC — 共址后这成了 T2T 预算的大头

← 上一章：chapter-05 OS 调优 · 下一节：6.2 TCP 与 UDP

### 网络基础与硬件

HFT 主要关注 **OSI 底层 + 传输层**：物理 · 数据链路 · 网络(IPv4) · 传输(TCP/UDP)。

| 设备 | 作用 | HFT 关注点 |
|------|------|-----------|
| **NIC** | 主机↔外界 | **PCIe 代际** · **10/25/100G** · **光纤口** · **硬件时间戳** |
| **Switch** | LAN 转发 | **Cut-through** · **HOL 阻塞** · 端口延迟 |

**NUMA：** NIC 与 **收包线程同 node** → chapter-04 §1 NUMA

### 交换机转发模式（延迟关键）

出口拥堵 → **排队延迟** · **丢包** · **HOL（Head-of-Line）阻塞**。

| 模式 | 行为 | HFT |
|------|------|-----|
| **Store-and-forward** | 收 **整帧** + **CRC** 后转发 | **慢** — 不适合 |
| **Cut-through** | 读 **前若干字节**（如 **目标 MAC 6B** 或 **64B fragment-free**）即转发 | **首选** |
| **Layer-1 Switch** | 物理层 **跳线**（Arista/Cisco 等）— **不解析修改头部** | **极低延迟** |

**共址机柜内** 交换机选型与 **NIC 延迟** 同为 **T2T 预算** 一部分。

← 下一节：6.2 TCP 与 UDP · 返回：本章索引

## 6.2 TCP 与 UDP

> 订单要可靠有序（TCP 会话），行情要快（UDP 组播）— 各走各路

← 上一节：6.1 网络硬件与交换机 · 下一节：6.3 金融应用层协议

| | **TCP** | **UDP** |
|---|---------|---------|
| **语义** | 可靠 · 有序 | 无连接 · **不保证送达** |
| **开销** | 握手 · 重传 | **低** |
| **HFT 分工** | **订单 (Orders)** — 关键会话 | **行情 (Market Data)** — 常 **Multicast** |
| **趋势** | 传统 OUCH 多 TCP | **UFO** 等 — **UDP 发单** 追极致速度 |

```
Market Data:  Exchange ──UDP multicast──► Gateway IN
Orders:       Gateway OUT ──TCP or UDP──► Exchange
```

→ chapter-02 Gateway

← 下一节：6.3 金融应用层协议 · 返回：本章索引

## 6.3 金融应用层协议

> 二进制固定布局 μs 级解析 — 字符串协议（FIX）只在控制面生存

← 上一节：6.2 TCP 与 UDP · 下一节：6.4 数据包生命周期

### 协议演进

| 协议 | 特点 | HFT |
|------|------|-----|
| **FIX** | **字符串** · 人类可读 · 解析慢 | 控制面/legacy |
| **FAST** | UDP + **压缩/增量** · 解压耗 CPU | 过渡 |
| **二进制（首选）** | **ITCH**（行情）· **OUCH**（订单）· **CME SBE** | **固定布局 · μs 解析** |

### Gateway IN 解码

wire format → **cast/模板解码** — 避免字符串扫描。

→ 19-markets-microstructure

← 下一节：6.4 数据包生命周期 · 返回：本章索引

## 6.4 数据包生命周期（Kernel 路径）

> 六步、每步 μs 级累积 + 缓存污染 — 这就是 Kernel Bypass 存在的理由

← 上一节：6.3 金融应用层协议 · 下一节：6.5 监控与时间同步

交易所数据到达 **NIC** 后的 **传统 Linux 路径**：

```
1. NIC DMA → RX ring buffer（内存）
2. 硬件 IRQ → CPU 打断用户态
3. 用户态 → 内核态（中断处理）
4. 分配 sk_buff · 剥 L2/L3/L4 头
5. 放入 socket 接收队列
6. 应用 recv() 再拷贝到用户缓冲
```

| 问题 | 每一步 **μs 级** 累积 + **缓存污染** |
|------|--------------------------------------|

### 这就是为什么需要 Kernel Bypass

- **OpenOnload / DPDK** — 用户态 **直接 poll RX ring** · **零拷贝**
- 详见 chapter-05 §3 Kernel Bypass

→ 13-DPDK Intro

← 下一节：6.5 监控与时间同步 · 返回：本章索引

## 6.5 监控与时间同步

> 监控永不触碰生产路径（TAP 带外）；时间要 ns 级（PTP + NIC 硬件戳）

← 上一节：6.4 数据包生命周期 · 下一节：6.6 广域链路

### 抓包：TAP

| 设备 | 说明 |
|------|------|
| **Passive TAP** | **分光** 复制流量 · **不需电源** · **不增加原链路延迟** |
| 用途 | 离线分析 · 对照 **硬件时间戳** |

**原则：** 监控 **不能** 影响生产路径 — TAP **带外**。

### PTP（精确时间协议）

| | **NTP** | **PTP (IEEE 1588)** |
|---|---------|---------------------|
| 精度 | ms 级 | **ns~ps 级**（硬件打戳） |
| HFT | 不够 | **T2T / 共址测量基石** |

- 源：**GPS / 原子钟**
- **NIC PHC** 打戳优于纯软件 `clock_gettime`

→ chapter-09 T2T 测量

← 下一节：6.6 广域链路 · 返回：本章索引

## 6.6 广域链路

> 微波比光纤快 ~1/3 — 跨所延迟套利（CME ↔ NYSE）买的是物理

← 上一节：6.5 监控与时间同步 · 返回：本章索引

跨数据中心 **Latency Arbitrage**（如 **CME ↔ NYSE**）：

| 介质 | 特点 |
|------|------|
| **传统光纤** | 光在玻璃 **~2/3 c** · 带宽高 · 稳定 |
| **Microwave 微波** | 空气 **~c** · **直线** · **最快** · **带宽极低** · **雨/云干扰** |
| **Hollow fiber 空芯光纤** | 芯内 **空气通道** · 快于实心 · 常 **DC ↔ 微波塔**（~数百码） |

**工程现实：** 容量、天气、许可、成本 — 与 **共址 + Cut-through** 同属基础设施栈。

→ 详见 chapter-09 §3 微波与空芯光纤

返回：本章索引

:::note 来源与许可
本文整理自 CShonor 的学习笔记仓库 [hft-embedded-linux-study](https://github.com/cshonor/hft-embedded-linux-study) 的 `14-hft-engineering` 模块（HFT 工程实践；该模块标注了与原书 Ch1–11 的对应关系，Ch10–13 为仓库自扩展章节），经作者授权以 CC BY 4.0 在本站署名发布。
:::

