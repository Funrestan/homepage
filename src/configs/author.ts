/**
 * 个人信息与链接行。链接行里每个条目都是一枚可拖拽的物理图标。
 */

/** 链接条目 */
export type AuthorLink = {
  name: string // 名称（也是悬浮提示文字与 v-for 的 key）
  url: string // 跳转地址；写给 donate 用的占位可以填 '#'
  icon: string // Iconify 图标名
  action?: string // 特殊行为：'donate' 表示不跳转，而是展开右侧内容块
  defaultColor?: string // 图标默认颜色，留空用 currentColor
  hoverColor?: string // 悬浮时的图标颜色
}

const author = {
  name: 'Funrestan', // 名字（同时用于 identity 的 {name} 与头像 alt）
  bio: "Have your fun, get your rest, be an original - that's Funrestan.", // 自我介绍（供引用，bio 的实际展示在 identity.ts 的 token 里）
  avatar: 'https://avatars.githubusercontent.com/u/195662688?v=4', // 头像地址

  // 链接行：数组顺序即显示顺序；带 action: 'donate' 的那条走 DonatePanel
  links: [
    {
      name: 'GitHub',
      url: 'https://github.com/Funrestan',
      icon: 'mingcute:github-line',
    },
    {
      name: 'Bilibili',
      url: 'https://space.bilibili.com/1524066943',
      icon: 'mingcute:bilibili-line',
      defaultColor: '', // 留空 = 跟随文字颜色
      hoverColor: '#FB7299', // B 站粉
    },
    {
      name: 'Telegram',
      url: 'https://t.me/funrestan',
      icon: 'stash:telegram',
      hoverColor: '#27A7E7',
    },
    {
      name: 'Blog',
      url: '#', // 待填：博客地址
      icon: 'mingcute:quill-pen-ai-line',
    },
    {
      name: 'FriendLinks',
      url: '#', // 待填：友链地址
      icon: 'zondicons:link',
    },
    {
      name: 'Donate',
      url: '#', // 不跳转，展开右侧内容块（见 donate.ts）
      icon: 'tabler:gift', // 这个图标同时用作飞行按钮实体与内容块的徽标
      action: 'donate', // 触发 Donate 展开动效的关键
    },
  ] as AuthorLink[],
}

export default author
