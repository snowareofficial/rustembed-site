---
title: "无锁数据结构与内存布局"
author: cshonor
date: 2026-10-20
tags: [ hft cpp performance ]
summary: "锁为什么不能用、无锁 FIFO 队列怎么写、内存预分配与缓存友好布局的工程手段。"
license: "CC BY 4.0"
series:
  id: hft-embedded-linux-14
  title: "HFT 工程实践"
  order: 7
---

## 7.1 传统锁的致命弱点

> 等锁 → sleep → 上下文切换 — mutex 把 μs 路径变成 ms 路径

← 上一章：chapter-05 OS 调优 · 下一节：7.2 无锁 FIFO 队列

| 问题 | 说明 |
|------|------|
| **Lock contention** | 多线程 **抢锁** — 串行化 |
| **Deadlock** | 循环等待 |
| **Priority inversion** | 低优先级 **持锁** → 高优先级 **被挡** |
| **Convoying（护航）** | 醒来的线程 **排队抢锁** — 全员慢 |
| **阻塞 + 切换** | 等锁 → **sleep** → chapter-05 上下文切换 |

**HFT 结论：** 关键路径 **不用 mutex** — 用 **无锁环** 或 **SPSC 单写单读**。

← 下一节：7.2 无锁 FIFO 队列 · 返回：本章索引

## 7.2 无锁 FIFO 队列

> 预分配固定数组 + 原子索引 — Gateway→Strategy 的主干道

← 上一节：7.1 传统锁的致命弱点 · 下一节：7.3 内存预分配与缓存友好

### SPSC / MPMC

```
[ slot0 | slot1 | … | slotN-1 ]   // 预分配固定数组
   ^last_write          ^last_read
```

| 模式 | 适用 |
|------|------|
| **SPSC** | 单 Gateway → 单 Strategy — **最简单** |
| **MPMC** | 多源行情 · 需 **原子 CAS** 或 **Disruptor 序列号** |

**实现要点：**

- **原子操作 / 自旋** — 线程 **busy-wait** 短临界区 · **不 yield**（避免切换）
- **release/acquire** 发布 slot 数据 — 见 7.5 C++ 内存序

### 应用场景

| 队列 | 作用 |
|------|------|
| **Gateway → Strategy** | 行情 **fan-out** |
| **Strategy → Logger** | **移出热点** — 异步落盘/统计 |
| **OMS → 审计** | 非关键路径 |

→ chapter-29 PipeDescriptor 对照 — 生产可用 **共享内存环** 替代消息队列

← 下一节：7.3 内存预分配与缓存友好 · 返回：本章索引

## 7.3 内存预分配与缓存友好

> 热点数据常驻 L1/L2；malloc 出现在热路径 = 延迟赌博

← 上一节：7.2 无锁 FIFO 队列 · 下一节：7.4 共享内存 IPC

### 延迟数量级

| 访问 | 约 |
|------|-----|
| **L1** | ~0.5 ns |
| **RAM** | ~60 ns |

**目标：** 热点数据 **常驻 L1/L2**。

### 空间与时间局部性

| 原则 | 实践 |
|------|------|
| **Spatial** | **`std::vector` / 数组** > `std::list` 指针追逐 |
| **Temporal** | 同一 order/book 结构 **反复访问** |
| **False sharing** | `read_idx` / `write_idx` **不同 cache line**（`alignas(64)`） |

### 消除不可预测分支

| 避免 | 原因 |
|------|------|
| **虚函数** | vtable · **阻碍 inline** · 分支预测失败 → **流水线清空** |
| **深 if-else** | misprediction 代价 |

**替代：** **CRTP / 模板** — chapter-08 §2 消除运行时决策 · chapter-04 §3 静态链接

### 禁止热点动态分配

| `malloc`/`new` 问题 | |
|---------------------|---|
| 堆 **遍历找块** | 延迟不确定 |
| **Heap fragmentation** | 长期运行 **破坏 locality** |

**终极方案：**

| 策略 | 说明 |
|------|------|
| **栈缓冲** | 小对象、生命周期短 |
| **Memory Pool** | 启动时 **一大块连续内存** · 自定义 **free-list / index stack** |
| **对象复用** | Order/Event **placement new** 回收到池 |

```cpp
// 示意：启动时
pool = mmap_huge(N * sizeof(MarketEvent));
free_stack = {0..N-1};

MarketEvent* acquire() {
    int i = free_stack.pop();
    return &pool[i];
}
```

→ chapter-05 Huge Pages

← 下一节：7.4 共享内存 IPC · 返回：本章索引

## 7.4 共享内存 IPC：mmap + 无锁环

> 多进程同看一块物理页 — Gateway 写、Strategy 读，零拷贝

← 上一节：7.3 内存预分配与缓存友好 · 下一节：7.5 C++ 内存序

| API | HFT 用法 |
|-----|----------|
| **`mmap(MAP_SHARED)`** | 文件 / **`/dev/shm`** / memfd → **多进程同物理页** |
| **非持久化** | 纯 RAM 环 · 不必落盘 |
| **+ FIFO** | Gateway 写 · Strategy 读 — **零拷贝 IPC** |

→ 原书 Ch7 §2：chapter-09 §2 mmap 与 IPC

← 下一节：7.5 C++ 内存序 · 返回：本章索引

## 7.5 C++ 内存序（无锁必备）

> release 发布 / acquire 消费 — 无锁环正确性的全部秘密

← 上一节：7.4 共享内存 IPC · 下一节：7.6 LMAX Disruptor

```cpp
// 生产者
slot[i] = event;
write_idx.store(i + 1, std::memory_order_release);

// 消费者
while (read_idx.load(std::memory_order_acquire) == write_idx) { /* spin */ }
consume(slot[read_idx]);
```

| 顺序 | 使用 |
|------|------|
| **release / acquire** | **发布-消费** 同步 |
| **relaxed** | 纯统计 |
| **seq_cst** | 默认过重 |

→ 展开：chapter-08 §1 C++ 内存模型

← 下一节：7.6 LMAX Disruptor · 返回：本章索引

## 7.6 LMAX Disruptor（参考架构）

> Ring buffer + Sequence + Batching — Mechanical Sympathy 的教科书实现

← 上一节：7.5 C++ 内存序 · 返回：本章索引

| 概念 | 说明 |
|------|------|
| **Ring buffer** | 预分配 Event **数组** |
| **Sequence** | 全局序号 · **无锁 claim** |
| **Batching** | 消费者 **批量** 处理降开销 |

返回：本章索引

:::note 来源与许可
本文整理自 CShonor 的学习笔记仓库 [hft-embedded-linux-study](https://github.com/cshonor/hft-embedded-linux-study) 的 `14-hft-engineering` 模块（HFT 工程实践；该模块标注了与原书 Ch1–11 的对应关系，Ch10–13 为仓库自扩展章节），经作者授权以 CC BY 4.0 在本站署名发布。
:::

