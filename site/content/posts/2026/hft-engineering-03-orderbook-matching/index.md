---
title: "交易所动态与订单簿"
author: cshonor
date: 2026-10-20
tags: [ hft quant ]
summary: "订单进入交易所后的路径、撮合引擎的三种场景与同价匹配算法，以及本地 Book Builder。"
license: "CC BY 4.0"
series:
  id: hft-embedded-linux-14
  title: "HFT 工程实践"
  order: 3
---

## 3.1 交易所核心功能与订单路径

> 撮合引擎是心脏；订单经 Router → 按品种/价格档 FIFO 队列进引擎

现代交易所已由 **Open Outcry（大厅喊价）** 转为 **全自动计算机撮合**。

| 组件 | 职责 |
|------|------|
| **Listings（上市）** | IPO、挂牌 |
| **Matching Engine（撮合引擎）** | **心脏** — ns 级发布订单簿、匹配买卖 |
| **Post-trade（盘后）** | 付款、结算、对账；**保证金** 防违约 |
| **Market Data（行情）** | 海量分发 → 催生 **Co-location（共址）** — 物理最近接 feed |
| **Regulation（监管）** | 操纵监控、透明度 |

```
Your HFT ──order──► Router ──► per-symbol/per-price FIFO queue ──► Matching Engine
                         ▲
              Market Data feed (co-located)
```

### 订单进入撮合的路径

1. 交易系统 **Gateway OUT** 发单至交易所
2. **Router** 按 **symbol（AAPL、MSFT…）** 路由
3. 按 **价格档位** 进入 **FIFO 队列**（在 FIFO 规则交易所）
4. **Matching Engine** 消费新单 + 当前 LOB → **Trade** 或 **Resting order**

**HFT 含义：** 你看到的 **queue position** 由 **到达时间 + 是否 amend 丢优先级** 决定。

## 3.2 撮合引擎三种基础场景

> Best Price / Partial Fill / No Match — 本地 Book 必须用相同语义重建 feed

**输入：** 新订单 + 当前订单簿 → **输出：** 成交记录和/或 **挂单（Resting）**。

### 最佳价格（Best Price）

- 引擎 **始终为新单找最优价**
- 例：买 @$100，簿上有卖 $99 与 $100 → **先以 $99 成交**（价格改善）

### 部分成交（Partial Fill）

- 买 4 股，最优卖单仅 1 股 → **先成交 1**
- 剩余 3 股：**继续吃下一档** 或 **挂入簿中**

### 无匹配（No Match）

- 买 @$98，最低卖 $99 → **不成交**，整单 **Rest** 在簿中提供流动性

**本地 Book Builder** 必须用 **相同语义** 重建 feed，策略才能 **模拟 queue / fill**。

## 3.3 同价匹配算法（核心）

> FIFO vs Pro-rata 决定策略：抢 1ns 还是堆量

多笔订单 **同价** 时，「谁先成交」**决定 HFT 生死**：

| 算法 | 规则 | HFT 策略 |
|------|------|----------|
| **FIFO（Time-Price）** | **时间戳最早** 优先；**改价**（部分所 **改量也**）→ **丢队尾** | **抢 1 ns** 排前；少 **amend** |
| **Pure Pro-rata** | 按 **挂单量比例** 分新单；**不看** 先后 | **加大 size** 换份额；速度次要 |
| **Pro-rata + Top-order** | **队首老单 100% 满额** → 余量 **按比例** | **速度 + 量** 混合博弈 |

### FIFO 的致命细节

> 修改价格（甚至数量）→ **失去原队列优先级** → 重新排到 **队尾**。

**推论：**

- 优化 **T2T / 共址** 在 FIFO 市场 **ROI 极高**
- **Cancel-Replace 策略** 需计 **re-queue 成本**

### 算法选择 → 系统设计

| 若交易所是… | 你应该… |
|-------------|---------|
| **FIFO** | 疯狂优化 **网络延迟**、「抢排头」 |
| **Pro-rata** | **加大挂单尺寸**、算 **份额公式** |
| **Top-order Pro-rata** | **既要快又要大** — 双轨优化 |

→ chapter-12 策略 · chapter-04 共址/硬件

## 3.4 共址与市场数据

> Co-location：机柜与撮合/行情源同机房；1 ns 也能形成执行优势

| 概念 | 说明 |
|------|------|
| **Co-location** | 机柜与 **撮合/行情源** 同机房 — **减传播延迟** |
| **Market Data** | 增量 feed 驱动 **本地 LOB** — 与引擎 **逻辑一致** |

**1 ns** 在 FIFO 中即可形成 **执行优势** — 与 chapter-09 T2T 测量目标一致。

## 3.5 本地 Book Builder 与行情解析

> O(1) 更新 · 预分配数组 · gap 恢复 · 多所归一化

理解交易所动态后，**Gateway IN + Book Builder** 必须：

| 工程要点 | 说明 |
|----------|------|
| **O(1) 更新** | add/modify/delete/trade |
| **Vector / 预分配** | 高 **cache hit** — 见 chapter-02 Book Builder |
| **Feed 解析** | Wire → struct；**gap → snapshot recovery** |
| **Normalize** | 多交易所 **统一内部 Event** |

→ 实现：chapter-08 引擎 · chapter-06 协议

:::note 来源与许可
本文整理自 CShonor 的学习笔记仓库 [hft-embedded-linux-study](https://github.com/cshonor/hft-embedded-linux-study) 的 `14-hft-engineering` 模块（HFT 工程实践；该模块标注了与原书 Ch1–11 的对应关系，Ch10–13 为仓库自扩展章节），经作者授权以 CC BY 4.0 在本站署名发布。
:::

