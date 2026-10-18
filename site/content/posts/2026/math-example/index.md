---
title: "公式示例：混合偏导数在一点的值"
author: sal
date: 2026-10-19
tags: [数学, 示例]
summary: "用一条混合偏导公式演示站点的 LaTeX 渲染：构建期转 MathML，不需要 KaTeX/MathJax，也没有外部请求。"
map: true
---

这条公式表示「先对 $x$、再对 $y$ 求偏导」在原点处的值，也可以看作固定 $x=0$ 后
$f_x(0,\cdot)$ 作为 $y$ 的一元函数在 $y=0$ 处的导数定义：

$$
\left.\frac{\partial^2 f}{\partial x\partial y}\right|_{(0,0)}=\lim_{y\to0}\frac{f_x(0,y)-f_x(0,0)}{y}
$$

## 怎么读

- 左边是混合偏导 $\partial^2 f/\partial x\partial y$ 在 $(0,0)$ 的取值；
- 右边把 $x$ 固定为 $0$，只让 $y$ 变化，用一元导数的定义写出；
- 若二阶偏导在 $(0,0)$ 附近连续，则 $f_{xy}=f_{yx}$（Clairaut–Schwarz 定理）。

## 再写两个变体

先对 $y$ 求导再对 $x$ 求导，形式完全对称：

$$
\left.\frac{\partial^2 f}{\partial y\partial x}\right|_{(0,0)}=\lim_{x\to0}\frac{f_y(x,0)-f_y(0,0)}{x}
$$

一元情形退化为熟悉的二阶导数：

$$
f''(0)=\lim_{h\to0}\frac{f'(h)-f'(0)}{h}
$$

## 写作提示

行内公式用 `$...$`，块公式用 `$$...$$`（独占连续几行）。构建期会转成 MathML，
浏览器原生渲染，不加载 KaTeX/MathJax，也不产生任何外部请求；写坏了会回退成等宽文本，不会让构建失败。
