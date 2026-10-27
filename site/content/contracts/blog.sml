# 内容契约：字段即文档。改这里 = 同时改校验规则和「文档 → 规范 → 内容契约」页。
#
# 应用方式两种：
#   1) 文件里写 `@is 契约名`（在文件顶部或块内首行）
#   2) 在 content/site.sml 的 `contracts { }` 里设默认契约，按内容类型生效
#
# 报错形如：content/posts/.../index.md: [E-CONTRACT-003] 契约 `BlogPost` 缺少必填字段 `summary`（字符串）
# 码表见 docs/ARCHITECTURE.md；与 SML 上游 sml-codes 对齐。

@contract BlogPost {
  title: str              # 标题
  author: str             # 成员 id，对应 content/members/<id>
  date: date              # 首次发布日期
  tags: [str]             # 标签，至少一个
  summary: str            # 一句话摘要（列表页与分享卡片用）
  updated: date optional  # 最后更新日期
  license: str optional   # 覆盖站点默认许可
  draft: bool optional    # 草稿：true 则不参与构建
  series: Series optional # 系列：自动进侧栏树与上一章/下一章
  video: str optional     # B 站 BV 号
  map: bool optional      # 是否在构建期生成章节导图（默认关，开启后弹层可拖动缩放）
  attachments: [Attachment] optional
  co_authors: [str] optional
  body: any optional      # SML 写法的正文块数组（Markdown 走 front matter + 正文）
  # 结构化块（可选，单对象）。Markdown 用 :::panel / :::steps / :::shot / :::gallery /
  # :::term / :::when 写法，SML 用对应裸块；渲染器统一按单对象处理，故契约也声明为单对象。
  panel: Panel optional
  steps: Steps optional
  shot: Shot optional
  gallery: Gallery optional
  term: Term optional
  when: When optional
}

@contract Panel loose {
  title: str optional      # 面板标题
  text: str optional       # 正文内容
}

@contract Steps loose {
  items: [Para] optional   # 步骤项
}

@contract Shot loose {
  src: str                 # 图片路径
  alt: str optional        # 替代文本
  caption: str optional    # 图注
  full: bool optional      # 是否全宽出血
}

@contract Gallery loose {
  cols: int optional       # 列数
  items: [Para] optional   # 图片项
}

@contract Term loose {
  text: str                # 终端输出文本（逐行保留，行间以 <br> 连接；与 MD :::term 完全一致，不做内联角色替换）
}

@contract When loose {
  date: str                # 日期（YYYY-MM-DD），渲染进 <span class="when-t">
  text: str                # 事件正文（唯一来源：优先取 text 字段，缺失时取子块渲染结果；与 MD :::when 围栏头之后的正文对齐）
}

@contract Series {
  id: str                 # 系列 id（相同 id 归为一组）
  order: int min 0        # 组内顺序
  title: str optional     # 系列显示名，缺省用 id
}

@contract Attachment {
  name: str               # 附件显示名（写 resource 时可省略，取资源 title）
  kind: enum [ image link ]  # image 入库；link 走作者自备外链
  url: str optional       # image 用相对路径（同目录 assets/），link 用 http(s)；
                          # 写 resource 时可由构建期解析出来（两者都空 → 构建报错）
  size: str optional      # 体积说明，image 可由构建自动填
  code: str optional      # 提取码（如蓝奏云）；只存值，不自动展示给未点击的人
  resource: str optional  # 引用资源 id：构建期解析 url / 提取码；资源更新则附件跟随
}

@contract Page {
  title: str              # 页面标题
  group: str              # 文档树归组（指南 / 写作 / 规范 / 关于 …）
  order: int min 0        # 同组内顺序
  body: any optional
  group_link: url optional # 该页顶部的行动按钮（如加群链接）
}

@contract Topic loose {
  title: str              # 词条名
  summary: str            # 一句话定义（知识页与词条页用）
  tags: [str] optional    # 同标签的文章会自动归入本词条
  posts: [str] optional   # 显式关联的文章 slug
  related: [str] optional # 相关词条 id
  body: any optional      # 定义、要点、参考资料
}

@contract Resource loose {
  title: str              # 资源名
  kind: enum [ book tutorial tool video course route ]  # 类型
  url: url                # 链接
  tags: [str] optional
  note: str optional      # 一句话说明
  folder: str optional    # 展示用分组（不建真实目录，URL 保持稳定）
  code: str optional      # 提取码；列表与附件卡显示「提取码 · 复制」
}

@contract Project {
  name: str               # 项目名
  one_liner: str          # 一句话简介
  repo: url               # 仓库地址（构建期抓元数据）
  status: enum [ active archived wip ]
  host: enum [ github gitee codeberg gitea ] optional
  homepage: url optional
  docs: url optional              # 外部文档 / 主页（别用它表达站内文章组）
  license: str optional
  languages: [str] optional
  platforms: [str] optional
  # 站内相关阅读（显式关联，仅此一条来源）：
  #   related_series —— 系列 id，取自文章 front matter 的 series.id；
  #   related_posts  —— 文章 slug（content/posts/<年>/[系列/]<短名> 的短名）。
  # 两者都空 = 项目页不渲染「相关阅读」区块，不回退到语言 / 标签自动匹配；
  # related_posts 里属于 related_series 已列系列的文章会被自动去重。
  related_series: [str] optional
  related_posts: [str] optional
  # 展示标签（chip）：技术标签（Rust / 物理引擎…）与编辑标签（社区精选…）两种，
  # 不写背书类标签（如「Gitee 推荐」）；status: active 会自动补「活跃开发」，不用手写。
  # 字段语义与写法见 docs/EDIT-SITE-DATA.md。
  tags: [str] optional
  owner: str optional     # 成员 id
  contributors: [str] optional
  featured: bool optional # 是否上首页精选
  meta_source: enum [ auto manual ] optional
  meta_override: any optional
  # 里程碑（可选）：有才在时间线上画，没有就不画 —— 前端绝不凭空生成节点
  # 写法：milestones: [ { date: 2026-10-16 text: "…" why: "…" } ]
  milestones: any optional
}

@contract Member loose {
  name: str               # 群昵称
  role: str optional      # 群主 / 管理员 / 群友 …
  avatar: str optional    # 头像文件路径（相对仓库根）
  signature: str optional # 个性签名
  skills: [str] optional
  joined: date optional
  links: MemberLinks optional
}

@contract MemberLinks loose {
  blog: url optional
  homepage: url optional  # 个人主页
  github: url optional
  gitee: url optional     # Gitee 个人空间
  gitee_org: url optional # Gitee 组织/第二个空间（一个人两个号时用这个，别写两个 gitee —— 对象键会互相覆盖）
  email: str optional     # 由本人提供并授权展示；不想公开就删掉这一行
}

# 能力与合作黄页：成员自愿登记、纯展示的条目。
# 性质：本站只做信息展示，不参与交易、不担保、不抽成、不经手资金、不介入纠纷，
#       也不为任何个人或服务背书；条目由 owner 本人提供并自负其责。
@contract Service {
  name: str               # 条目名称（能力/服务一句话名）
  owner: str              # 成员 id，必须存在于 content/members/<id>.sml
  skills: [str]           # 技能标签，至少一个
  wants: [str] optional   # 想找什么（合作方向，自由列举）
  contact: [str]          # 联系方式：只能引用成员档案 links 里本人已公开的键（blog/homepage/github/gitee/gitee_org/email）
  rate: str optional      # 费用/方式说明，自由文本；本站不经手资金，具体由双方自行约定
  status: enum [ active paused ]  # active = 可接洽；paused = 暂停
  updated: date           # 最近更新日期
  body: any optional      # 详细介绍（SML 块 / Markdown 正文）
}

@contract Weekly loose {
  period: str             # 期号，如 2026-W38
  title: str              # 本期标题
  highlights: [str] optional
  merged: [str] optional  # 关联文章 slug
  contributors: [str] optional
  body: any optional
}
