title: "Rust嵌入式探讨"
tagline: "一个 QQ 群的技术共建博客：嵌入式、Rust，以及把想法做出来的过程"
url: "https://rec-blog.swebase.cn"
domains: [ "rec-blog.swebase.cn" "rust-embed.swebase.cn" ]
# 仓库地址的唯一数据源：内容、文档、产物（llms.txt 等）都引用这里，避免多处各写一遍
repo_url: "https://gitee.com/rustembed/site"
# 第二个源：同一份代码的另一个发布点（作为 SML 应用示例）
repo_mirror: "https://gitee.com/snoware/sml-sitegen"
default_license: "CC BY-NC-SA 4.0"
announcement: "投稿请提 PR，或把稿子交给有仓库权限的群管理代投。讨论回 QQ 群。"
nav: [ library knowledge topics projects resources members services weekly pages join ]

# PR 默认审核人（写作台 /api/pr 带出，可增删）；环境变量 REC_BLOG_REVIEWERS 可覆盖
reviewers: [ sal ]

# 默认契约：按内容类型自动套用（文件里写 @is 可覆盖）
contracts {
  post: BlogPost
  page: Page
  resource: Resource
  topic: Topic
  project: Project
  member: Member
  weekly: Weekly
  service: Service
}

group {
  name: "Rust嵌入式探讨"
  qq: "947963288"
  join_url: "https://qm.qq.com/q/uo06W0c7Is"
  join: "加群验证：说出你最近在啃的一块板子"
  intro: "面向嵌入式与 Rust 的学习/实践群。这里存放群友写的技术文章、做过的项目、整理的资源，以及这个群本身的故事。"
  rules: [
    "不讨论与技术和学习无关的内容"
    "提问前先说清目标、现象、已尝试过的办法"
    "转载与引用他人内容必须标注出处与许可"
    "投稿即视为同意按站点默认许可公开发布"
  ]
  features: [
    "群文件：资料、原理图、固件镜像索引"
    "每周分享：一人一个正在做/刚做完的东西"
    "答疑：embedded-hal / no_std / 调试工具链"
    "共建博客：文章与项目走 PR 投稿、群管理审核"
  ]
  timeline: [
    { date: 2026-09-19 text: "群博客立项，仓库与构建流水线定型" }
  ]
}
