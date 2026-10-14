import AuthorInfo, { type AuthorLink } from '../configs/author'

/** 链接条目类型（沿用 author.ts 的定义） */
export type ProfileLink = AuthorLink

/** author.ts 中的链接列表，顺序即下排显示顺序 */
export const authorLinks = AuthorInfo.links

/** action 为 donate（或名为 Donate）的链接走右侧内容块，而不是直接跳转。 */
export const isDonateLink = (link: ProfileLink) => link.action === 'donate'
  || link.name.toLowerCase() === 'donate'

export const findDonateLink = () => authorLinks.find(isDonateLink) ?? null
