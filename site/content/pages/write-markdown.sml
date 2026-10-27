title: "Markdown 写作速查"
group: 写作
order: 1

body: [
  topic 最小可用模板 {
    children: [
      para { text: "新建 content/posts/<年份>/[系列/]<英文短名>/index.md，粘贴下面这段就能开工。" }
      code { lang: markdown text: "---\ntitle: \"文章标题\"\nauthor: 你的成员id\ndate: 2026-09-20\ntags: [ rust embedded ]\nsummary: \"一两句摘要\"\n---\n\n## 第一个小节\n\n正文……" }
      para { text: "作者 id 与 content/members/<id>.sml 对应；没有档案也能发，只是不会链接到个人页。" }
    ]
  }

  topic 正文语法 {
    children: [
      table {
        head: [ 写法 效果 ]
        rows: [
          [ "## 标题" "小节标题（会进侧栏章节树与导图）" ]
          [ "**粗体** / *斜体* / ~~删除线~~" "行内样式" ]
          [ "`行内代码`" "等宽高亮" ]
          [ "[文字](https://…)" "链接" ]
          [ "![说明](assets/x.png)" "图片（图放同目录 assets/）" ]
          [ "![说明](assets/x.png \"图注\")" "带图注的图" ]
          [ "> 引用" "引用块" ]
          [ "- 列表 / 1. 列表" "无序 / 有序，缩进两格可嵌套" ]
          [ "| a | b |" "表格（第二行写 |---|）" ]
          [ "单独一行 BV 号" "自动嵌入 B 站视频" ]
        ]
      }
    ]
  }

  topic 进阶 {
    children: [
      ul {
        items: [
          "系列文章：front matter 里写 series: {id, title, order}，会自动进侧栏树并生成上一章/下一章"
          "视频：也可以写在 front matter 的 video 字段"
          "附件：图片入库（同目录 assets/），其余外链，写在 front matter 的 attachments 里"
          "内联角色：{ref: 锚点|文字}、{term: 术语}、{math: \"公式\"}、{link: url|文字} 在 Markdown 里同样可用"
          "字段写错会被内容契约拦下，报错形如 [E-CONTRACT-003] 缺少必填字段 summary（字符串）"
          "契约清单与字段说明见「文档 → 规范 → 内容契约」（由 content/contracts/*.sml 自动生成）"
        ]
      }
      note { text: "构建会校验必填字段、图片是否存在、附件类型与体积；写错会直接报错，不用自己猜。" }
    ]
  }

  topic 加资源 / 项目 / 成员 / 互助（SML） {
    children: [
      para { text: "文章用 Markdown；资源、项目、成员、互助是结构化条目，用 SML。SML 不是编程，只是「字段: 值」列表。" }
      code { lang: sml text: "title: \"The Embedded Rust Book\"\nkind: book\nurl: \"https://docs.rust-embedded.org/book/\"\ntags: [ rust embedded book ]\nnote: \"官方入门书，no_std 与外设访问的基础概念都在这里。\"" }
      para { text: "复制模板到 content/resources/<英文短名>.sml；引擎按目录自动套 Resource 契约，不需要写契约名。" }
      para { text: "字段表用 python engine/cli.py contracts 查看；完整模板在仓库 templates/ 与 docs/CONTRIBUTING.md。" }
    ]
  }

  topic 不会 git / 不想折腾 {
    children: [
      para { text: "把 Markdown / SML 文件和图片打包发到群里，说明作者署名用哪个 id。" }
      para { text: "有仓库权限的管理员代投，PR 里注明原作者；预览链接发回给你确认。" }
      para { text: "不需要注册 Gitee、不需要配 SSH。" }
    ]
  }
]
