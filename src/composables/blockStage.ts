/**
 * 右侧板块（侧栏之右的整块区域）同一时刻只允许一个块占用。
 *
 * 协议：
 * ① 想占用右侧中心的块，在打开时调用 claimRightStage('自己的名字')；
 * ② 各块自行监听 RIGHT_STAGE_EVENT，收到别人的 claim 时把自己收起。
 * 目前只有 Donate 块占用它（它负责监听并让位），未来新增块照这个协议接即可。
 */

export const RIGHT_STAGE_EVENT = 'homepage:right-stage-claim'

/** Donate 块自己的占用者名字：它自己发起的 claim 会被忽略。 */
export const DONATE_STAGE_OWNER = 'donate'

export const claimRightStage = (owner: string) => {
  window.dispatchEvent(new CustomEvent(RIGHT_STAGE_EVENT, { detail: { owner } }))
}
