/**
 * 站点级信息：背景图、标题、一言开关、页脚与背景来源标注。
 */
const site = {
  'background-img': '/background.jpg', // 亮色主题背景图（public 下的路径，也可写外链）
  'darkmode-background-img': '/background-dark.jpg', // 暗色主题背景图
  title: "Funrestan's Homepage", // 浏览器标签标题
  showBackgroundInfo: true, // 是否在右下角显示背景图出处
  hitokoto: {
    enable: true, // 是否显示一言
    url: 'https://international.v1.hitokoto.cn', // 一言接口地址（返回 {hitokoto, from}）
  },
  // 背景图出处列表（右下角标注），可多条
  backgroundInfo: [
    {
      author: '紺屋', // 画师名
      authorUrl: 'https://www.pixiv.net/users/10109777', // 画师主页
      imgSource: 'https://www.pixiv.net/artworks/121764304', // 作品地址
      name: 'ガード下のメニュー', // 作品名
    },
    {
      author: '半节',
      authorUrl: 'https://www.pixiv.net/users/6179964',
      imgSource: 'https://www.pixiv.net/artworks/143520010',
      name: '秦心接力二宣图',
    },
  ],
  right: '2026 Funrestan. All rights reserved.', // 页脚版权文字（留空则不显示）
  // 页脚备案等链接，可多条
  icp: [
    {
      name: '萌ICP备20262224号', // 链接文字
      url: 'https://icp.gov.moe/?keyword=20262224', // 链接地址
    },
  ],
}

export default site
