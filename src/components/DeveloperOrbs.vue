<script setup lang="ts">
/**
 * 开发者小球层：Teleport 到 body 的一层 fixed 容器（**pointer-events: none**，
 * 只有小球与名片自己收点击），球的位置由 useDeveloperOrbs 每帧直接写 transform。
 *
 * 生命周期由父组件驱动：友链球悬停在右上方时 begin()，它归位时 release()。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import DeveloperConfig from '../configs/developers'
import {
  useDeveloperOrbs,
  type DeveloperMagnet,
  type DeveloperOrbView,
} from '../composables/useDeveloperOrbs'

const props = defineProps<{
  /** 每帧现读友链球的位置与半径（它被拖动时磁铁跟着走） */
  getMagnet: () => DeveloperMagnet | null
}>()

const {
  views,
  attracted,
  heldId,
  draggingId,
  heldAnchor,
  begin,
  release,
  destroy,
  register,
  hold,
  beginDrag,
  moveDrag,
  endDrag,
} = useDeveloperOrbs({
  getMagnet: () => props.getMagnet(),
  // 名片挂上之后量它的实际矩形，交给引擎当静态碰撞箱
  getCardRect: () => {
    const rect = cardElement.value?.getBoundingClientRect()
    return rect ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : null
  },
})

/** 这一轮指针按下的那颗球（松手时若没怎么动就算"点了一下"） */
let pressedOrb: DeveloperOrbView | null = null
let dragPointerId: number | null = null

const cardVisible = ref(false)
const cardOrb = ref<DeveloperOrbView | null>(null)
const cardElement = ref<HTMLElement | null>(null)
/** 名片实测高度：决定往上弹还是往下弹（内容长短会变） */
const cardHeight = ref(190)

const visual = DeveloperConfig.visual
const card = DeveloperConfig.card
const crown = DeveloperConfig.crown

/** 皇冠/特殊描述用到的主题色变量：容器与名片是两棵独立的树，所以两边都要下发 */
const crownVars = computed(() => ({
  '--dev-crown-color': crown.color,
  '--dev-crown-highlight': crown.highlightColor,
  '--dev-crown-glow': crown.glow,
  '--dev-crown-shadow': crown.shadow,
  '--dev-special-color': crown.card.color,
  '--dev-special-color-dark': crown.card.darkColor,
  '--dev-special-bg': crown.card.background,
  '--dev-special-border': crown.card.border,
  '--dev-crown-breathe-duration': `${crown.breathe.duration}ms`,
  '--dev-crown-breathe-min': String(crown.breathe.minimumOpacity),
}))

/**
 * 名片位置：朝**远离友链球**的那一侧弹（小球通常聚在友链球下方，所以默认弹在它下方，
 * 否则名片会压在友链球底下、被它盖住）；再按视口收一下边。
 */
const cardStyle = computed(() => {
  const anchor = heldAnchor.value
  if (!anchor) return { left: '0px', top: '0px' }
  const magnet = props.getMagnet()
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const half = card.width / 2
  // 朝"远离友链球"的那一侧弹：小球通常聚在友链球下方 → 名片就弹在它下方，
  // 否则名片会长在友链球底下、被它那颗更大的实体压住。
  let below = magnet ? anchor.y > magnet.y : anchor.y - anchor.radius < card.flipMargin
  if (below && anchor.y + anchor.radius + card.gap + cardHeight.value > viewportHeight - 12) below = false
  if (!below && anchor.y - anchor.radius - card.gap - cardHeight.value < 12) below = true
  const gap = anchor.radius + card.gap
  const top = below ? anchor.y + gap : anchor.y - gap
  const left = Math.min(viewportWidth - 12 - half, Math.max(12 + half, anchor.x))
  return {
    left: `${left.toFixed(1)}px`,
    top: `${top.toFixed(1)}px`,
    width: `${card.width}px`,
    transform: below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
    '--dev-card-origin': below ? 'top center' : 'bottom center',
  }
})

const openCard = (orb: DeveloperOrbView) => {
  if (heldId.value === orb.id) {
    closeCard()
    return
  }
  cardOrb.value = orb
  cardVisible.value = true
  hold(orb.id)
}

const closeCard = () => {
  cardVisible.value = false
  hold(null)
}

const goTo = (url: string) => {
  if (!url || url === '#') return
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * 拖动小球。加固点（移动端踩过的坑，和 PhysicsItem 同一套）：
 * 不用 lostpointercapture 结束手势；pointerup / pointercancel / blur / visibilitychange 都当收尾；
 * setPointerCapture 失败就退化成靠 window 上的 pointermove 继续跟手。
 */
const detachDragListeners = () => {
  window.removeEventListener('pointermove', handlePointerMove)
  window.removeEventListener('pointerup', handlePointerUp)
  window.removeEventListener('pointercancel', handlePointerUp)
  window.removeEventListener('blur', handlePointerCancel)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  dragPointerId = null
}

const handlePointerMove = (event: PointerEvent) => {
  if (dragPointerId !== null && event.pointerId !== dragPointerId) return
  moveDrag(event.clientX, event.clientY)
}

const handlePointerUp = (event: PointerEvent) => {
  if (dragPointerId !== null && event.pointerId !== dragPointerId) return
  const orb = pressedOrb
  detachDragListeners()
  const wasClick = endDrag()
  pressedOrb = null
  if (wasClick && orb) openCard(orb)
}

const handlePointerCancel = () => {
  detachDragListeners()
  endDrag()
  pressedOrb = null
}

const handleVisibilityChange = () => {
  if (document.hidden) handlePointerCancel()
}

const handleOrbPointerDown = (orb: DeveloperOrbView, event: PointerEvent) => {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  event.preventDefault()
  pressedOrb = orb
  dragPointerId = event.pointerId
  beginDrag(orb.id, event.clientX, event.clientY)
  try {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  } catch { /* 捕获失败就靠 window 的 pointermove，照样能拖 */ }
  window.addEventListener('pointermove', handlePointerMove)
  window.addEventListener('pointerup', handlePointerUp)
  window.addEventListener('pointercancel', handlePointerUp)
  window.addEventListener('blur', handlePointerCancel)
  document.addEventListener('visibilitychange', handleVisibilityChange)
}

/** 点名片外面 / 按 Esc 收起名片 */
const handleWindowPointerDown = (event: PointerEvent) => {
  if (!cardVisible.value) return
  const target = event.target
  if (!(target instanceof Element)) return
  if (target.closest('.dev-card') || target.closest('.dev-orb')) return
  closeCard()
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || !cardVisible.value) return
  closeCard()
}

watch(cardVisible, (visible) => {
  if (visible) {
    window.addEventListener('pointerdown', handleWindowPointerDown, { capture: true })
    window.addEventListener('keydown', handleKeydown)
  } else {
    window.removeEventListener('pointerdown', handleWindowPointerDown, { capture: true })
    window.removeEventListener('keydown', handleKeydown)
    cardOrb.value = null
  }
})

// 友链球归位（断磁）时，被钉住的那颗球也放开，名片跟着收掉
watch(heldId, (id) => {
  if (id === null && cardVisible.value) closeCard()
})

// 名片内容长短不一，挂上之后量一次实际高度，定位才准
watch([cardVisible, heldId], async () => {
  if (!cardVisible.value) return
  await nextTick()
  if (cardElement.value) cardHeight.value = cardElement.value.offsetHeight
})

const hostLabel = (value: string) => {
  try {
    return new URL(value).host
  } catch {
    return value
  }
}

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', handleWindowPointerDown, { capture: true })
  window.removeEventListener('keydown', handleKeydown)
  detachDragListeners()
  destroy()
})

defineExpose({ begin, release, closeCard })
</script>

<template>
  <Teleport to="body">
    <div
      class="dev-orbs"
      :style="{
        zIndex: visual.zIndex,
        '--dev-ring': visual.ring,
        '--dev-shadow': visual.shadow,
        '--dev-glow': visual.glowColor,
        '--dev-glow-duration': `${visual.glowDuration}ms`,
        ...crownVars,
      }"
    >
      <button
        v-for="orb in views"
        :key="orb.id"
        :ref="(element) => register(orb.id, element as HTMLElement | null)"
        type="button"
        class="dev-orb"
        :class="{
          'is-attracted': attracted,
          'is-held': heldId === orb.id,
          'is-dragging': draggingId === orb.id,
        }"
        :style="{ width: `${orb.diameter}px`, height: `${orb.diameter}px` }"
        :title="orb.name"
        :aria-label="`${orb.name}：点开名片，也可以拖动`"
        @pointerdown="handleOrbPointerDown(orb, $event)"
        @contextmenu.prevent
      >
        <!-- 环绕光效：一圈缓慢自转的金色光环（只给戴皇冠的那位） -->
        <span
          v-if="orb.crown && crown.ring.enable"
          class="dev-orb__ring"
          aria-hidden="true"
          :style="{
            inset: `${crown.ring.inset}px`,
            '--dev-crown-ring-width': `${crown.ring.width}px`,
            '--dev-crown-ring-a': crown.ring.colorA,
            '--dev-crown-ring-b': crown.ring.colorB,
            '--dev-crown-ring-duration': `${crown.ring.duration}ms`,
            '--dev-crown-ring-direction': crown.ring.reverse ? 'reverse' : 'normal',
            '--dev-crown-ring-glow': crown.ring.glow,
          }"
        />
        <img class="dev-orb__avatar" :src="orb.avatar" :alt="orb.name" draggable="false" />
        <!-- 皇冠头饰：贴在小球上沿、稍微歪着戴 -->
        <span
          v-if="orb.crown && crown.enable"
          class="dev-orb__crown"
          aria-hidden="true"
          :style="{
            width: `${orb.diameter * crown.sizeRatio}px`,
            '--dev-crown-tilt': `${crown.tilt}deg`,
            '--dev-crown-offset-y': `${orb.diameter * crown.offsetYRatio}px`,
            '--dev-crown-color': crown.color,
            '--dev-crown-highlight': crown.highlightColor,
            '--dev-crown-shadow': crown.shadow,
            '--dev-crown-glow': crown.glow,
          }"
        >
          <Icon :icon="crown.icon" />
        </span>
      </button>
    </div>

    <!-- 名片单独一层：层级压在所有东西之上（面板 55 / 友链球 58 之下都不再挡它） -->
    <Transition name="dev-card">
      <div
        v-if="cardVisible && cardOrb"
        class="dev-card-anchor"
        :style="{ ...cardStyle, zIndex: card.zIndex, ...crownVars }"
      >
        <div ref="cardElement" class="dev-card" role="dialog" :aria-label="cardOrb.name">
          <img class="dev-card__avatar" :src="cardOrb.avatar" :alt="cardOrb.name" draggable="false" />
          <div class="dev-card__body">
            <p class="dev-card__name">{{ cardOrb.name }}</p>
            <!-- 皇冠专属的特殊描述：写了才显示，单独一条更醒目 -->
            <p v-if="cardOrb.crownInfo" class="dev-card__special">
              <Icon :icon="crown.icon" aria-hidden="true" />
              {{ cardOrb.crownInfo }}
            </p>
            <p v-if="cardOrb.info" class="dev-card__info">{{ cardOrb.info }}</p>
            <p class="dev-card__host">{{ hostLabel(cardOrb.url) }}</p>
          </div>
          <button
            type="button"
            class="dev-card__close"
            :aria-label="card.closeLabel"
            :title="card.closeLabel"
            @click.stop="closeCard"
          >
            <Icon icon="mingcute:close-line" />
          </button>
          <button
            type="button"
            class="dev-card__go"
            :disabled="!cardOrb.url || cardOrb.url === '#'"
            @click.stop="goTo(cardOrb.url)"
          >
            前往
            <Icon icon="mingcute:arrow-right-line" />
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dev-orbs {
  position: fixed;
  inset: 0;
  /* 整层不接管指针，只有小球与名片自己收 */
  pointer-events: none;
}

.dev-orb {
  position: absolute;
  top: 0;
  left: 0;
  display: block;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  pointer-events: auto;
  cursor: grab;
  will-change: transform;
  /* 移动端拖动加固：不吃滚动手势、不弹长按菜单、不闪高亮 */
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
  transition: opacity 260ms ease;
}

.dev-orb.is-dragging {
  cursor: grabbing;
}

.dev-orb.is-dragging .dev-orb__avatar {
  transform: scale(1.1);
  box-shadow:
    inset 0 0 0 2px var(--dev-ring),
    0 18px 34px rgb(12 42 82 / 52%);
}

.dev-orb.is-fading {
  opacity: 0;
}

.dev-orb__avatar {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  box-shadow:
    inset 0 0 0 2px var(--dev-ring),
    var(--dev-shadow);
  transition: transform 220ms cubic-bezier(0.2, 1.3, 0.35, 1);
}

/* 环绕光效：用 padding + mask 差集抠出一圈，再让 conic-gradient 自转（明暗会流动） */
.dev-orb__ring {
  position: absolute;
  border-radius: 50%;
  padding: var(--dev-crown-ring-width);
  box-sizing: border-box;
  background: conic-gradient(
    from 0deg,
    var(--dev-crown-ring-b) 0deg,
    var(--dev-crown-ring-a) 70deg,
    var(--dev-crown-ring-b) 150deg,
    var(--dev-crown-ring-b) 210deg,
    var(--dev-crown-ring-a) 290deg,
    var(--dev-crown-ring-b) 360deg
  );
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  mask-composite: exclude;
  /* 用 filter 而不是 box-shadow：box-shadow 会被上面的 mask 一起裁掉 */
  filter: var(--dev-crown-ring-glow);
  animation: dev-crown-spin var(--dev-crown-ring-duration) linear infinite;
  animation-direction: var(--dev-crown-ring-direction);
  pointer-events: none;
}

/* 停住时的呼吸：和友链球那圈辐射错开节奏 */
.dev-orb.is-attracted .dev-orb__ring {
  animation-name: dev-crown-spin, dev-crown-breathe;
  animation-duration: var(--dev-crown-ring-duration), var(--dev-crown-breathe-duration);
  animation-timing-function: linear, ease-in-out;
  animation-iteration-count: infinite, infinite;
  animation-direction: var(--dev-crown-ring-direction), normal;
}

/* 皇冠头饰：贴在小球上沿、稍微歪着戴 */
.dev-orb__crown {
  position: absolute;
  left: 50%;
  top: 50%;
  display: grid;
  place-items: center;
  transform: translate(-50%, -50%) translateY(var(--dev-crown-offset-y)) rotate(var(--dev-crown-tilt));
  color: var(--dev-crown-color);
  /* 先描一圈光晕，再勾一道上沿高光，最后压投影 */
  filter: var(--dev-crown-glow) var(--dev-crown-shadow)
    drop-shadow(0 -1px 0 var(--dev-crown-highlight));
  pointer-events: none;
}

.dev-orb__crown :deep(svg) {
  width: 100%;
  height: auto;
}

@keyframes dev-crown-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes dev-crown-breathe {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: var(--dev-crown-breathe-min);
  }
}

/* 被友链球吸住时：边缘一圈缓慢呼吸的微光 */
.dev-orb.is-attracted .dev-orb__avatar {
  filter: drop-shadow(0 0 10px var(--dev-glow));
  animation: dev-breathe var(--dev-glow-duration) ease-in-out infinite;
}

.dev-orb:hover .dev-orb__avatar {
  transform: scale(1.08);
}

.dev-orb.is-held .dev-orb__avatar {
  box-shadow:
    inset 0 0 0 2px var(--dev-glow),
    var(--dev-shadow);
}

@keyframes dev-breathe {
  0%,
  100% {
    filter: drop-shadow(0 0 6px var(--dev-glow));
  }
  50% {
    filter: drop-shadow(0 0 14px var(--dev-glow));
  }
}

/* ═══════════ 名片：贴着小球的毛玻璃气泡 ═══════════ */
/* 定位层只负责钉在小球旁边（transform 用来对齐，不参与过渡），
   缩放/模糊/透明都放在内层 .dev-card 上，免得两者抢同一个 transform */
.dev-card-anchor {
  position: fixed;
}

.dev-card {
  display: grid;
  grid-template-columns: auto 1fr auto;
  grid-template-areas:
    'avatar body close'
    'go go go';
  align-items: center;
  gap: 0.65rem 0.75rem;
  padding: 1rem 1rem 0.9rem;
  border-radius: 1rem;
  border: 1px solid rgb(255 255 255 / 45%);
  background: rgb(255 255 255 / 62%);
  backdrop-filter: blur(18px);
  box-shadow: 0 18px 44px rgb(12 42 82 / 28%);
  pointer-events: auto;
}

:global(html.dark .dev-card) {
  border-color: rgb(148 163 184 / 28%);
  background: rgb(15 23 42 / 68%);
  box-shadow: 0 18px 44px rgb(0 0 0 / 45%);
}

.dev-card__avatar {
  grid-area: avatar;
  width: 3rem;
  height: 3rem;
  border-radius: 50%;
  object-fit: cover;
  box-shadow: inset 0 0 0 2px var(--dev-ring);
}

.dev-card__body {
  grid-area: body;
  min-width: 0;
}

.dev-card__name {
  font-size: 0.98rem;
  font-weight: 600;
  color: rgb(31 41 55);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dev-card__info {
  margin-top: 0.15rem;
  font-size: 0.78rem;
  line-height: 1.45;
  color: rgb(75 85 99);
  /* 配置里 info 写的 \n 要真的换行：HTML 默认会把换行折叠成空格，pre-line 保留换行但照常折行 */
  white-space: pre-line;
}

/* 皇冠专属的特殊描述：单独一条、金色底 */
.dev-card__special {
  display: flex;
  align-items: center;
  gap: 0.32rem;
  margin-top: 0.35rem;
  padding: 0.22rem 0.5rem;
  border-radius: 0.5rem;
  border: 1px solid var(--dev-special-border);
  background: var(--dev-special-bg);
  color: var(--dev-special-color);
  font-size: 0.74rem;
  font-weight: 600;
  line-height: 1.4;
  white-space: pre-line;
}

.dev-card__special :deep(svg) {
  flex: 0 0 auto;
  width: 0.85rem;
  height: 0.85rem;
  color: var(--dev-crown-color);
}

:global(html.dark .dev-card__special) {
  color: var(--dev-special-color-dark);
}

.dev-card__host {
  margin-top: 0.3rem;
  font-size: 0.7rem;
  color: rgb(107 114 128);
}

:global(html.dark .dev-card__name) {
  color: rgb(241 245 249);
}

:global(html.dark .dev-card__info) {
  color: rgb(203 213 225);
}

:global(html.dark .dev-card__host) {
  color: rgb(148 163 184);
}

.dev-card__close {
  grid-area: close;
  align-self: start;
  display: grid;
  place-items: center;
  width: 1.5rem;
  height: 1.5rem;
  border: none;
  border-radius: 50%;
  background: rgb(0 0 0 / 6%);
  color: rgb(75 85 99);
  cursor: pointer;
  transition: background 160ms ease, color 160ms ease;
}

.dev-card__close:hover {
  background: rgb(0 0 0 / 12%);
  color: rgb(17 24 39);
}

:global(html.dark .dev-card__close) {
  background: rgb(255 255 255 / 10%);
  color: rgb(203 213 225);
}

:global(html.dark .dev-card__close:hover) {
  background: rgb(255 255 255 / 18%);
  color: rgb(255 255 255);
}

/* 「前往」：毛玻璃按键（透出名片/背景，不抢内容的视觉） */
.dev-card__go {
  grid-area: go;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  margin-top: 0.2rem;
  padding: 0.45rem 0.75rem;
  border: 1px solid rgb(255 255 255 / 55%);
  border-radius: 0.7rem;
  background: rgb(255 255 255 / 34%);
  backdrop-filter: blur(10px) saturate(140%);
  -webkit-backdrop-filter: blur(10px) saturate(140%);
  color: rgb(30 58 95);
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 60%),
    0 6px 16px rgb(12 42 82 / 18%);
  transition: background 180ms ease, box-shadow 180ms ease, transform 180ms cubic-bezier(0.2, 1.3, 0.35, 1);
}

.dev-card__go:hover {
  background: rgb(255 255 255 / 52%);
  transform: translateY(-1px);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 70%),
    0 10px 22px rgb(12 42 82 / 24%);
}

.dev-card__go:active {
  transform: translateY(0);
}

:global(html.dark .dev-card__go) {
  border-color: rgb(226 232 240 / 26%);
  background: rgb(255 255 255 / 14%);
  color: rgb(241 245 249);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 22%),
    0 6px 16px rgb(0 0 0 / 30%);
}

:global(html.dark .dev-card__go:hover) {
  background: rgb(255 255 255 / 22%);
}

.dev-card__go:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none;
}

/* 名片进出场：从贴着小球的那一侧"长出来" */
.dev-card {
  transform-origin: var(--dev-card-origin, bottom center);
  transition:
    opacity 200ms ease,
    filter 200ms ease,
    transform 220ms cubic-bezier(0.18, 0.86, 0.24, 1);
}

.dev-card-enter-from .dev-card,
.dev-card-leave-to .dev-card {
  opacity: 0;
  filter: blur(8px);
  transform: scale(0.94) translateY(8px);
}

@media (prefers-reduced-motion: reduce) {
  .dev-orb.is-attracted .dev-orb__avatar {
    animation: none;
  }
  .dev-card {
    transition-duration: 1ms;
  }
}
</style>
