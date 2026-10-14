/**
 * Donate 右侧内容块的内容与开关。
 * 触发条件：author.ts 里带 action: 'donate' 的链接；图标与标题沿用那条链接的 icon。
 * 留空的二维码会显示一个虚线占位框。
 */
const donate = {
  enable: true, // false 时 Donate 变回普通链接，不再展开右侧内容块
  title: '打钱', // 内容块标题
  subtitle: '感谢你的赞助或向我付款', // 标题下的一句说明
  closeLabel: '关闭赞助面板', // 关闭按钮的无障碍标签与提示
  qrPendingLabel: '暂不支持该渠道喵~', // 未填 qr 时占位框里的文字
  qrBackLabel: '点击任意处返回', // 收款码视图里提示怎么回到渠道列表
  qrOpenLabel: '打开收款页', // 收款码视图里跳转按钮的文字

  // —— 赞助渠道：数组顺序即显示顺序 ——
  channels: [
    {
      name: '支付宝',
      detail: '支付宝支付二维码',
      url: '#',
      icon: 'mingcute:alipay-line',
      hoverColor: '#1677FF',
      qr: 'public/donate-alipay.png',
    },
    {
      name: '微信',
      detail: '微信支付二维码',
      url: '#',
      icon: 'mingcute:wechat-line',
      hoverColor: '#07C160',
      qr: 'public/donate-wechat.png',
    },
    {
      name: 'QQ钱包',
      detail: '神秘QQ不让提取收款码,故暂不支持',
      url: '#',
      icon: 'mingcute:qq-line',
      hoverColor: '#12B7F5',
      qr: '',
    },
  ],

  note: '', // 内容块底部备注
}

export default donate
