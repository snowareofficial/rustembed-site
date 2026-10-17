# 文章摘要（构建期 AI 步骤）

给 AI / GUI 用的固定约定。产物落到 `site/content/summaries/<slug>.json`，
下次 `python engine/cli.py build` 会自动采用，并在页面上标注「AI · 构建期」。

## 输入

```json
{
  "title": "文章标题",
  "summary": "作者写的一句话摘要（可能为空）",
  "tags": ["标签"],
  "text": "正文纯文本（构建期已去标签，最多 4000 字）"
}
```

## 输出（严格 JSON，不要 Markdown 代码块）

```json
{
  "one_line": "一句话摘要，<=60 字，说清这篇解决什么问题",
  "points": ["3–6 条要点，每条 <=40 字，按文章顺序"],
  "keywords": ["3–6 个关键词，优先复用 tags"]
}
```

## 约束

- 只根据输入写，不补充外部事实；不确定就不写。
- 中文标点；不要「本文」「作者」这类空话开头。
- 要点是给扫读者看的结论，不是章节标题的复述。
- 失败/超时就不要写文件：构建会退回抽取式摘要（章节标题 + tags），不会阻塞发布。

## 调用方式（示例，二选一）

```bash
# CLI 批处理：把每篇的输入喂给模型，输出写回 summaries/<slug>.json
python engine/cli.py list --json > /tmp/posts.json
```

```python
# 或在自己的脚本里：
import json, pathlib
from engine.lib import summary  # 只读，不联网
post = {...}                    # 至少要有 slug/title/summary/tags/words/toc
# 调模型 -> data，然后：
pathlib.Path("site/content/summaries", post["slug"] + ".json").write_text(
    json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
```

> 站点本身**不联网、不在运行时调用 AI**：摘要只在构建期生成，页面零第三方请求。
