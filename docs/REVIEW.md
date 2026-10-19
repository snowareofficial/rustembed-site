# 审稿

面向：PR 审核人、值班维护者。目标不是“挑错”，而是让内容能安全、可回滚地上线。

## 审稿入口

1. 看 PR 的 base 是不是 **`staging`**；
2. 等 CI 的 preview 构建完成；
3. 打开 preview 链接，按下面清单看；
4. 通过就合并到 `staging`；有问题就留具体意见，不要只说“再改改”。

## 审稿清单

### 内容

- [ ] 标题、摘要、作者 id 正确；
- [ ] 技术表述没有明显错误；
- [ ] 没有把他人内容写成原创；
- [ ] 引用/转载标注了出处和许可；
- [ ] 没有联系方式、住址、证件号等不该公开的个人信息；
- [ ] 互助条目没有报价、交易、抽成、担保措辞。

### 格式

- [ ] 文章在 `site/content/posts/<年份>/<短名>/index.md`；
- [ ] front matter 必填字段齐全（`title/author/date/tags/summary`）；
- [ ] 图片在文章同目录 `assets/`，没有外部图床；
- [ ] 代码块有语言标记；
- [ ] 公式能正常渲染，没有字面 `\command`；
- [ ] 移动端预览没有横向溢出。

### 安全

- [ ] 没有提交 token、密码、私钥、`.env`；
- [ ] 没有 `javascript:` / `data:` 链接；
- [ ] 没有引入外部脚本或统计；
- [ ] 附件类型/体积符合规则。

### 构建

```bash
python engine/cli.py build --offline
python engine/cli.py check
python engine/test_structure.py
python engine/test_contracts.py
```

CI 已经跑过的话可以只看结果；本地改过内容就自己再跑一遍。

## 预览链接

- staging 预览：`https://preview.rustembed.pages.dev/`
- 生产：`https://rec-blog.swebase.cn/`
- 如果 preview 没更新，先看 CI 是否成功，不要直接合并。

## 合并

- 审核通过：合并到 `staging`；
- 需要发布生产：由维护者把 `staging` 合并到 `master`；
- **不要让作者直接推 `master`**；
- 合并后确认 preview 正常，再决定是否 promote。

## 打回时怎么写意见

好的意见要能直接执行：

```text
第 2 段：`r(A)` 这里应该是 `r(A)=1`，当前推导不成立。
图片 `assets/board.jpg` 没入库，preview 里是裂图。
front matter 缺 `summary`，构建会报 E-CONTRACT-003。
```

不要写“感觉不对”“再优化一下”，作者不知道改什么。

## 常见退回原因

| 原因 | 处理 |
|---|---|
| PR base 是 `master` | 改成 `staging` |
| 构建失败 | 让作者看 CI 日志；字段错误按错误码改 |
| 图片裂了 | 把图片放进 `assets/` 并重新提交 |
| 公式字面量 | 检查 `\textcircled`、`\displaylimits`、`\Big \{` 等兼容性 |
| 内容像广告 | 退回，改成技术互助/信息展示措辞 |
| 没有署名/授权 | 补作者 id 或明确授权 |

## 相关

- 改数据：[`EDIT-SITE-DATA.md`](EDIT-SITE-DATA.md)
- 发布/回滚：[`OPS.md`](OPS.md)
- 完整流程：[`WORKFLOW.md`](WORKFLOW.md)
