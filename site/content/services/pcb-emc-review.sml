# 能力与合作黄页示例。改成本人信息即可；不想展示就把整个文件删掉。
# 硬性规则：
#   owner 必须是成员 id（content/members/<id>.sml）；
#   contact 只能写该成员 links 里已公开的键（blog / homepage / github / gitee / email）
#   —— 本站不代收任何新联系方式，不介入交易与纠纷。

name: "PCB 布局与 EMC 走线复查"
owner: sal
skills: [ pcb emc altium stm32 ]
wants: [ "小批量硬件合作" "固件移植咨询" ]
contact: [ email gitee ]
rate: "按板计费，学生项目半价；细节发邮件谈，本站不经手任何费用"
status: active
updated: 2026-10-16

body: [
  para { text: "两层改四层、开关电源布局、USB / CAN 的 EMI 问题都可以发过来看。按「走线 + 回流路径 + 接口保护」三件事给结论，附修改建议。" }
  topic 能做什么 {
    children: [
      ul {
        items: [
          "布局与分层评审：电源入口、时钟线、敏感模拟区"
          "EMC 预扫：贴片后不过认证的常见原因（回流路径、共地、线束）"
          "小批量打样跟线：嘉立创 / 捷配都可，出了问题协助定位"
        ]
      }
    ]
  }
  topic 合作方式 {
    children: [
      para { text: "先发 Gerber 与原理图，一小时内回复能不能接；报酬与周期双方自行约定，走你自己的渠道结算。本站只展示这条信息，不担保结果、不抽成、不介入纠纷。" }
    ]
  }
]
