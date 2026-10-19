# 给 hy3 的 P0 提示词：技术互助改名 / 授权声明

> 前置：hy3 的 i18n phase 1 已合入，`site/theme/app.js`、`engine/build.py` 归你。
> 本任务**只改文案与数据**，不改路由、不改契约字段、不改布局结构。

```text
在 rec-blog 做 P0「技术互助」改名与授权声明。仓库：C:\Users\sakeen\Desktop\rec-blog
先确认 i18n 已合入、工作区干净；不要 rebase/force。
先读 docs/TECH-MUTUAL-AID.md。

# 只改这些文件
site/theme/app.js
engine/build.py
site/content/services/pcb-emc-review.sml
docs/ARCHITECTURE.md
tests/structure 或新增 tests/tech-aid_test.py（只读断言）
不要改：gui/**、engine/gui*.py、site/theme/i18n*（i18n 已定）、契约字段、路由。

# 改动清单

1) 导航与标题
   - TYPE_LABEL.services: '能力与合作' → '技术互助'
   - 搜索类型 chips 里的 '黄页' → '互助'
   - 服务列表页标题/说明：'能力与合作' / '能力与合作黄页' → '技术互助'
   - 详情页 crumb/title：'能力与合作' → '技术互助'；空态 '没有这条黄页' → '没有这条互助'
   - 统计文案 '黄页 N' → '互助 N'（app.js 与 build.py 的 summary 都要改）

2) 两栏语义（只改文案，不改字段）
   - skills 标题：'能帮上什么'
   - wants 标题：'想一起做什么'
   - rate 标签：'费用 / 方式' → '协作方式（不谈价格）'
   - status 显示：active → '可协作'，paused → '暂缓'
   - 页面顶部加一句：
     这里只做技术互助与能力互补，不涉及设备买卖、报价与商务对接。

3) 条目底部声明（替换现有那句）
   本站只展示这条信息：不参与交易、不担保结果、不抽成、不经手资金、不介入纠纷。

4) 页脚授权分层声明（build.py 注入；三行原文见 docs/TECH-MUTUAL-AID.md §2）
   - 文章/词条/知识库：CC BY-NC-SA 4.0，禁止商业性使用；
   - 成员档案自我介绍/照片/能力信息：版权归成员本人，仅用于技术协作联系，
     未经同意不得商业招揽/打包售卖/对外培训；购买服务不等于内容商用授权；
   - 本站不参与交易撮合、资金托管、交付担保，不背书。
   - 注意：新增中文文案若不在现有字体子集里，确认 site_text() 收集到了；
     否则构建会漏字（看构建 warning）。

5) 示例内容 site/content/services/pcb-emc-review.sml
   - rate 改为协作方式，例如：
     "远程评审；需要寄样板时走快递；时间与方式私聊，不谈价格"
   - wants 去掉商业词：
     [ "小批量硬件一起做" "固件移植交流" ]
   - 正文里 '报酬与周期双方自行约定…' 改成 '时间与方式双方自行约定…'
   - 顶部注释 '能力与合作黄页示例' → '技术互助示例'

6) 文档
   - docs/ARCHITECTURE.md 里 '能力与合作黄页' / '黄页' → '技术互助'
   - 不要动 docs/GUI*.md（hy4 的）

# 测试
- python engine/cli.py build --offline && python engine/cli.py check
- 全文搜索 dist/ 不应出现 '黄页'（允许 docs 历史记录除外）
- 页脚包含三行声明；服务页包含 '技术互助'、'协作方式（不谈价格）'、'能帮上什么'、'想一起做什么'
- 现有 tests 全绿；不新增依赖。

# 非目标
- 不做主页「能力图谱」（P1）；
- 不做成员作品集聚合（P1）；
- 不改 Service 契约字段（rate 保留）；
- 不改 URL / 路由。

提交：docs/... 与 code 分开 commit；本地提交、不 push、不 force。
```

P1（等 P0 稳定后再做）：主页「能力图谱」chip 聚合、成员页作品集、项目页协作记录。
