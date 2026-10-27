title: "投稿与共建指南"
group: 指南
order: 1

body: [
  topic 投稿方式 {
    children: [
      ol {
        items: [
          "fork 仓库 → 新建 posts/<年份>/[系列/]<英文短名>/index.md → 提 PR"
          "不方便用 git：把稿子交给有仓库权限的群管理，由对方代投（署名仍是你的）"
        ]
      }
      para { text: "审核人会在 3 天内响应；退稿会给明原因（格式、事实、许可、附件问题）。构建脚本会直接报出格式错误，不用自己猜。" }
    ]
  }

  topic 两种正文格式 {
    children: [
      para { text: "默认写 {em: Markdown}（index.md），与 SML（index.sml）渲染出的样式、章节树、搜索索引完全一致。" }
      para { text: "需要严格字段类型校验或写定理/证明时，再用 SML。" }
      code { lang: markdown text: "---\ntitle: \"标题\"\nauthor: sal\ndate: 2026-09-20\ntags: [ rust embedded ]\nsummary: \"一两句摘要\"\n---\n\n## 小节标题\n\n正文，支持**粗体**、`行内代码`、表格、引用、代码块、图片。\n\n单独一行放 B 站视频号会自动嵌入：BV1GJ411x7h7" }
      para { text: "SML 版本写法见 posts/2026/hello-rec/index.sml；块类型 topic/section/para/code/quote/ul/table/img/note/theorem 等。" }
    ]
  }

  topic 字段与附件 {
    children: [
      ul {
        items: [
          "必填：title / author / date / tags / summary"
          "可选：updated / license / series / video（BV 号）/ attachments / co_authors"
          "图片放同目录 assets/，正文写相对路径 assets/xxx.png"
          "PDF、压缩包、固件等一律外链，写进 attachments 并从作者侧保证可用"
          "系列文章用 series: {id, title, order}，会自动进入侧栏树与上一章/下一章"
        ]
      }
    ]
  }

  topic 字段写错会怎样 {
    children: [
      para { text: "每种内容都有契约（内容契约页在「文档 → 规范」里，由 content/contracts/*.sml 自动生成）。字段漏填或类型不对，构建会直接报出错误码 + 人话：" }
      code { lang: text text: "content/posts/2026/xxx/index.md: E-CONTRACT-003 契约 `BlogPost` 缺少必填字段 `summary`（字符串）" }
      para { text: "这不是在卡人，而是 {em: 契约本身就是字段文档}：想加字段就去改契约，改完校验与文档页同时更新。" }
    ]
  }

  topic 署名与许可 {
    children: [
      para { text: "默认按站点许可 {em: CC BY-NC-SA 4.0} 发布，可用 license 字段单独覆盖。引用他人内容必须标出处。" }
    ]
  }
]
