<script setup lang="ts">
/**
 * 友链飞行实体：一枚**真正的物理条目**（可拖、有碰撞箱、松手弹回原位），
 * 里面再套一层做"飞出去 / 缩回"的行程与缩放。
 *
 * 为什么宿主自己不飞：物理条目每帧由 useSoftPhysics 写 --physics-x/--physics-y，
 * WAAPI 的 transform 会被覆盖（见 App.vue 的技术决策）。所以分三层：
 *   · .friend-avatar-anchor —— 锚点，钉在"右侧板块上半场中心"（宿主的"家"就是这儿）；
 *   · .friend-avatar-offset —— 让位层：礼物面板顶缘压过来时往上挪（不参与物理，
 *     但"家"是按 实际位置 − 物理位移 算的，所以让位之后松手也是弹回让位后的位置）；
 *   · .friend-avatar（行程）> .friend-avatar__body（缩放）—— 才是 1 倍 ↔ scale.end 倍 的飞行。
 *
 * 圆影与定位：宿主的布局盒子 = icon.size × scale.end（3 倍 = 72px），它就是碰撞箱，
 * 也是背后那团圆影的直径；停住不拖时圆影向外辐射光效，一被拖动就暂停。
 */
import { Icon } from '@iconify/vue'
import { nextTick, onBeforeUnmount, ref } from 'vue'
import FriendsConfig from '../configs/friends'
import PhysicsConfig from '../configs/physics'
import { findFriendLink } from '../composables/profileLink'
import { sampleDampedSpring } from '../composables/dampedSpring'
import PhysicsItem from './PhysicsItem.vue'

type Point = { x: number; y: number }

const emit = defineEmits<{
  /** 停稳之后点它一下（由父组件负责收回） */
  close: []
}>()

const friends = FriendsConfig
const friendIcon = findFriendLink()?.icon ?? 'zondicons:link'

const anchor = ref<HTMLElement | null>(null)
const offsetLayer = ref<HTMLElement | null>(null)
const content = ref<HTMLElement | null>(null)
const body = ref<HTMLElement | null>(null)
const item = ref<{ getElement: () => HTMLElement | null } | null>(null)
const itemVisible = ref(false)
/** 停稳后才接管指针：飞行途中点它、拖它都不算 */
const interactive = ref(false)
const anchorStyle = ref({ left: '0px', top: '0px', width: '0px', height: '0px' })
/** 停稳后才显示辐射光（飞行中先不辐射，免得像个"已经在等你点"的靶子） */
const glowing = ref(false)
/** 落点（不含让位偏移）的中心 y：让位偏移以它为基准算 */
let baseY = 0
let avoidOffset = 0
let avoidAnimation: Animation | null = null

/** icon.size（如 1.5rem）折算成像素：按根字号算，避免写死 24。 */
const iconPixelSize = () => {
  const raw = String(friends.icon.size).trim()
  const value = Number.parseFloat(raw)
  if (!Number.isFinite(value)) return 24
  return raw.endsWith('rem')
    ? value * Number.parseFloat(getComputedStyle(document.documentElement).fontSize || '16')
    : value
}

/** 图标"3 倍"之后的视觉边长（px）：缩放通道的终点尺寸 */
const glyphSize = () => iconPixelSize() * friends.scale.end

/** 边界框体（= 碰撞箱 = 圆影直径 = 点击热区）的边长，比图标大 box.scale 倍 */
const boxSize = () => glyphSize() * friends.box.scale

const contentTransform = (dx: number, dy: number, scale: number) =>
  `translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0) scale(${Math.max(0.02, scale).toFixed(4)})`

/** 让位层当前**实际画在**哪（读到实际值，中途改目标才不会跳）。 */
const currentAvoid = () => {
  const element = offsetLayer.value
  if (!element) return avoidOffset
  const transform = getComputedStyle(element).transform
  if (!transform || transform === 'none') return 0
  try {
    return new DOMMatrixReadOnly(transform).m42 || 0
  } catch {
    return avoidOffset
  }
}

/** 让位偏移用弹簧过渡到 shift（0 = 回到上半场中心）。 */
const animateAvoidTo = (shift: number) => {
  const element = offsetLayer.value
  if (!element) {
    avoidOffset = shift
    return
  }
  const start = currentAvoid()
  // 已经到位（或目标几乎没变）就不要打断正在跑的弹簧——曾经在 cancel 之后再提前返回，
  // 结果最后一帧把动画取消掉、图标自己跳回原位。
  if (Math.abs(shift - start) < 0.5) {
    avoidOffset = shift
    return
  }
  avoidAnimation?.cancel()
  avoidAnimation = null
  avoidOffset = shift
  const track = sampleDampedSpring(
    { avoid: { offset: start - shift, velocity: 0 } },
    friends.avoid.spring,
  )
  const values = track.values.avoid ?? []
  avoidAnimation = element.animate(
    track.times.map((time, index) => ({
      offset: time / track.settleTime,
      transform: `translate3d(0, ${(shift + (values[index] ?? 0)).toFixed(2)}px, 0)`,
      easing: 'linear',
    })),
    { duration: track.settleTime, fill: 'forwards' },
  )
}

/**
 * 礼物面板长高了就把自己往上让：传入面板顶缘的 y（null = 面板不在/不需要让位）。
 * 底边最多贴到"顶缘 − gap"，够高就停在上半场中心不动。
 */
const setKeepOutTop = (topEdge: number | null) => {
  if (!friends.avoid.enable || topEdge === null || !itemVisible.value) {
    animateAvoidTo(0)
    return
  }
  const allowed = topEdge - friends.avoid.gap - boxSize() / 2 - baseY
  animateAvoidTo(Math.min(0, allowed))
}

/**
 * 供父组件调用：从链接行原位飞到上半场中心，同时从 1 倍长到 scale.end 倍。
 * keepOutTop = 礼物面板顶缘（面板已经占着中部时传进来，落点会自动收在它上面）。
 */
const openFrom = async (origin: Point, target: Point, keepOutTop: number | null = null) => {
  avoidAnimation?.cancel()
  avoidAnimation = null
  avoidOffset = 0
  if (offsetLayer.value) offsetLayer.value.style.transform = 'translate3d(0, 0, 0)'

  const size = boxSize()
  let landing = target
  if (friends.avoid.enable && keepOutTop !== null) {
    const maxY = keepOutTop - friends.avoid.gap - size / 2
    if (landing.y > maxY) landing = { x: landing.x, y: maxY }
  }
  // 上边距兜底：窄屏视口矮的时候 0.2 × 高度仍可能贴到最上边
  const minY = friends.target.topMargin + size / 2
  if (landing.y < minY) landing = { x: landing.x, y: minY }
  baseY = landing.y
  anchorStyle.value = {
    left: `${(landing.x - size / 2).toFixed(2)}px`,
    top: `${(landing.y - size / 2).toFixed(2)}px`,
    width: `${size}px`,
    height: `${size}px`,
  }
  itemVisible.value = true
  interactive.value = false
  glowing.value = false
  await nextTick()

  const travelElement = content.value
  const scaleElement = body.value
  if (!travelElement || !scaleElement) return

  // 起点：内容层先退回"链接行里那个原点"，并缩到 1/end（布局盒子已是 end 倍，所以视觉就是 1 倍）
  const dx = origin.x - landing.x
  const dy = origin.y - landing.y
  const endScale = friends.scale.end
  const startScale = 1 / endScale
  const spring = friends.scale.spring
  const omega = 2 * Math.PI * spring.frequency
  const scaleOffset = startScale - 1

  const travelAnimation = travelElement.animate([
    { offset: 0, transform: contentTransform(dx, dy, 1) },
    { offset: 1, transform: contentTransform(0, 0, 1) },
  ], {
    duration: friends.flight.duration,
    easing: friends.flight.easing,
    fill: 'forwards',
  })

  // 缩放：起点偏离 = startScale - 1（负值），终点 1；过冲由 spring 的阻尼与频率解析算出
  const track = sampleDampedSpring({
    scale: {
      offset: scaleOffset,
      velocity: friends.scale.launch * omega * Math.abs(scaleOffset),
    },
  }, spring)
  const scaleValues = track.values.scale ?? []
  const scaleAnimation = scaleElement.animate(
    track.times.map((time, index) => ({
      offset: time / track.settleTime,
      transform: `scale(${Math.max(0.02, 1 + (scaleValues[index] ?? 0)).toFixed(4)})`,
      easing: 'linear',
    })),
    { duration: track.settleTime, delay: friends.scale.lead, fill: 'forwards' },
  )

  await Promise.all([
    travelAnimation.finished.catch(() => undefined),
    scaleAnimation.finished.catch(() => undefined),
  ])
  interactive.value = true
  glowing.value = true
}

/**
 * 供父组件调用：从**现在画在哪儿**收回链接行的落点（landing）。
 * 行程与缩放挂在同一根 closeSpring 上，所以两者同步缩回去、一起冲过落点再弹回。
 * 出发点用宿主实时的中心（可能刚被拖过、正在归位），所以开始时不会跳。
 */
const closeTo = async (landing: Point) => {
  interactive.value = false
  glowing.value = false
  // 让位偏移不参与这次动画（出发点是实测位置，已经含它了），等收完随组件一起消失
  const hostRect = item.value?.getElement()?.getBoundingClientRect()
  const start = hostRect
    ? { x: hostRect.left + hostRect.width / 2, y: hostRect.top + hostRect.height / 2 }
    : landing

  const spring = friends.close.spring
  const dx = landing.x - start.x
  const dy = landing.y - start.y
  const omega = 2 * Math.PI * spring.frequency
  const endScale = friends.scale.end

  // 归一化弹簧：travel 从 0 → 1（= 从当前位置到落点），scale 从 1 → 1/end
  const track = sampleDampedSpring({
    travel: {
      offset: -1,
      velocity: friends.close.launch * omega,
    },
    scale: {
      offset: 1 - 1 / endScale,
      velocity: -friends.close.launch * omega * (1 - 1 / endScale),
    },
  }, spring)

  const travelValues = track.values.travel ?? []
  const scaleValues = track.values.scale ?? []
  const travelElement = content.value
  const scaleElement = body.value
  if (!travelElement || !scaleElement) return

  const travelAnimation = travelElement.animate(
    track.times.map((time, index) => {
      const progress = 1 + (travelValues[index] ?? 0)
      return {
        offset: time / track.settleTime,
        transform: contentTransform(dx * progress, dy * progress, 1),
        easing: 'linear',
      }
    }),
    { duration: track.settleTime, fill: 'forwards' },
  )

  const scaleAnimation = scaleElement.animate(
    track.times.map((time, index) => ({
      offset: time / track.settleTime,
      transform: `scale(${Math.max(0.02, 1 / endScale + (scaleValues[index] ?? 0)).toFixed(4)})`,
      easing: 'linear',
    })),
    { duration: track.settleTime, fill: 'forwards' },
  )

  await Promise.all([
    travelAnimation.finished.catch(() => undefined),
    scaleAnimation.finished.catch(() => undefined),
  ])
}

/** 收场：卸载这枚物理条目（下次飞出去时会重新挂一枚干净的，物理位移自然归零）。 */
const hideFlight = () => {
  avoidAnimation?.cancel()
  avoidAnimation = null
  avoidOffset = 0
  if (offsetLayer.value) offsetLayer.value.style.transform = 'translate3d(0, 0, 0)'
  itemVisible.value = false
  interactive.value = false
  glowing.value = false
}

const handleClick = () => {
  if (!interactive.value) return
  emit('close')
}

/** 友链球此刻的位置与半径：开发者小球每帧拿它当磁铁（所以它被拖动时磁铁跟着走）。 */
const getMagnet = () => {
  const element = item.value?.getElement()
  if (!element || !itemVisible.value) return null
  const rect = element.getBoundingClientRect()
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    radius: Math.max(rect.width, rect.height) / 2,
  }
}

onBeforeUnmount(() => {
  avoidAnimation?.cancel()
  avoidAnimation = null
})

defineExpose({ openFrom, closeTo, hideFlight, setKeepOutTop, getMagnet })
</script>

<template>
  <Teleport to="body">
    <span
      v-if="itemVisible"
      ref="anchor"
      class="friend-avatar-anchor"
      :style="{
        ...anchorStyle,
        zIndex: FriendsConfig.icon.zIndex,
        '--friend-box-size': `${boxSize()}px`,
        '--friend-glyph-size': `${glyphSize()}px`,
        '--friend-icon-size': FriendsConfig.icon.size,
        '--friend-icon-color': FriendsConfig.icon.lightColor,
        '--friend-icon-color-dark': FriendsConfig.icon.darkColor,
        '--friend-icon-shadow': FriendsConfig.icon.shadow,
        '--friend-halo-inner': FriendsConfig.halo.light.innerColor,
        '--friend-halo-mid': FriendsConfig.halo.light.midColor,
        '--friend-halo-outer': FriendsConfig.halo.light.outerColor,
        '--friend-halo-edge': FriendsConfig.halo.light.edgeColor,
        '--friend-halo-rim': FriendsConfig.halo.light.rimColor,
        '--friend-halo-shadow': FriendsConfig.halo.light.shadow,
        '--friend-halo-blur': `${FriendsConfig.halo.light.blur}px`,
        '--friend-halo-inner-dark': FriendsConfig.halo.dark.innerColor,
        '--friend-halo-mid-dark': FriendsConfig.halo.dark.midColor,
        '--friend-halo-outer-dark': FriendsConfig.halo.dark.outerColor,
        '--friend-halo-edge-dark': FriendsConfig.halo.dark.edgeColor,
        '--friend-halo-rim-dark': FriendsConfig.halo.dark.rimColor,
        '--friend-halo-shadow-dark': FriendsConfig.halo.dark.shadow,
        '--friend-halo-blur-dark': `${FriendsConfig.halo.dark.blur}px`,
        '--friend-glow-color': FriendsConfig.glow.color,
        '--friend-glow-opacity': String(FriendsConfig.glow.opacity),
        '--friend-glow-duration': `${FriendsConfig.glow.duration}ms`,
        '--friend-glow-start': String(FriendsConfig.glow.startScale),
        '--friend-glow-end': String(FriendsConfig.glow.endScale),
        '--friend-glow-easing': FriendsConfig.glow.easing,
        '--friend-glow-resume': `${FriendsConfig.glow.resumeDuration}ms`,
      }"
    >
      <span ref="offsetLayer" class="friend-avatar-offset">
        <PhysicsItem
          ref="item"
          class="friend-avatar-host"
          :class="{ 'is-interactive': interactive }"
          :mass="PhysicsConfig.presets.link.mass"
          :influence="FriendsConfig.entity.influence"
          :cooldown="PhysicsConfig.presets.link.cooldown"
          :settle-collision-cooldown="PhysicsConfig.presets.link.settleCollisionCooldown"
          shape="round"
        >
          <span ref="content" class="friend-avatar">
            <span
              ref="body"
              class="friend-avatar__body"
              role="button"
              :aria-label="FriendsConfig.closeLabel"
              @click="handleClick"
            >
              <span
                v-if="FriendsConfig.halo.enable"
                class="friend-avatar__halo"
                aria-hidden="true"
              />
              <span
                v-for="layer in FriendsConfig.glow.enable ? FriendsConfig.glow.layers : 0"
                :key="layer"
                class="friend-avatar__glow"
                :class="{ 'is-glowing': glowing }"
                aria-hidden="true"
              >
                <span
                  class="friend-avatar__glow-ring"
                  :style="{ animationDelay: `${(layer - 1) * FriendsConfig.glow.layerDelay}ms` }"
                />
              </span>
              <Icon :icon="friendIcon" class="friend-avatar__icon" />
            </span>
          </span>
        </PhysicsItem>
      </span>
    </span>
  </Teleport>
</template>

<style scoped>
/* 锚点：钉在落点上；层本身不接管指针（里层的物理条目自己收） */
.friend-avatar-anchor {
  position: fixed;
  pointer-events: none;
}

/* 让位层：礼物面板长高时只有这一层平移，物理条目的"家"会跟着它走 */
.friend-avatar-offset {
  position: absolute;
  inset: 0;
  will-change: transform;
}

/* 宿主 = 物理条目：布局盒子就是碰撞箱，也是圆影的直径 */
.friend-avatar-host {
  position: absolute;
  inset: 0;
  pointer-events: none;
  /* 物理条目默认 preserve-3d，会让后代的 backdrop-filter 失效（毛玻璃看着全透明）；
     这里摊平，圆影那层磨砂才生效（同 Donate 面板的处理） */
  transform-style: flat;
}

.friend-avatar-host.is-interactive {
  pointer-events: auto;
}

/* 行程层（translate）与缩放层（scale）分开，两条动画挂在两个元素上，互不覆盖。
   尺寸必须写成明确的像素（--friend-box-size）：宿主的 .physics-item__content 是 inline-flex
   自适应宽度，百分比高度在这里会退化成 auto，图标最后只剩 1em（16px）。 */
.friend-avatar {
  position: relative;
  display: grid;
  place-items: center;
  width: var(--friend-box-size);
  height: var(--friend-box-size);
  will-change: transform;
}

.friend-avatar__body {
  position: relative;
  display: grid;
  place-items: center;
  width: var(--friend-box-size);
  height: var(--friend-box-size);
  will-change: transform;
}

/* 圆形背后阴影：直径 = 100% 宿主盒子 = 碰撞箱。
   亮暗两套（不许通用）：亮色 = 白色磨砂球，暗色 = 深色玻璃球，各自都把背后画面磨一下。
   注意毛玻璃的前提是宿主 transform-style: flat（见下）。 */
.friend-avatar__halo {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: radial-gradient(
    circle at 50% 44%,
    var(--friend-halo-inner) 0%,
    var(--friend-halo-mid) 46%,
    var(--friend-halo-outer) 74%,
    var(--friend-halo-edge) 100%
  );
  backdrop-filter: blur(var(--friend-halo-blur));
  -webkit-backdrop-filter: blur(var(--friend-halo-blur));
  /* 1px 内描边给圆影一个轮廓，外面再压一层往下投的影子 */
  box-shadow:
    inset 0 0 0 1px var(--friend-halo-rim),
    var(--friend-halo-shadow);
}

:global(html.dark .friend-avatar__halo) {
  background: radial-gradient(
    circle at 50% 44%,
    var(--friend-halo-inner-dark) 0%,
    var(--friend-halo-mid-dark) 46%,
    var(--friend-halo-outer-dark) 74%,
    var(--friend-halo-edge-dark) 100%
  );
  backdrop-filter: blur(var(--friend-halo-blur-dark));
  -webkit-backdrop-filter: blur(var(--friend-halo-blur-dark));
  box-shadow:
    inset 0 0 0 1px var(--friend-halo-rim-dark),
    var(--friend-halo-shadow-dark);
}

/* 辐射光：外层只管显隐（opacity + 暂停），内层那圈光环才做扩散——
   分成两层是因为"动画里的 opacity"会盖过普通规则里的 opacity，
   拖动时要淡掉的话，显隐就不能写在动画元素自身上。 */
.friend-avatar__glow {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  opacity: 0;
  transition: opacity var(--friend-glow-resume) ease;
}

.friend-avatar__glow.is-glowing {
  opacity: var(--friend-glow-opacity);
}

.friend-avatar__glow-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  /* 明显的"一圈光环"：中段给一段窄而实的色带，内外都化开，
     纯色填充看起来只是"变亮的圆"，不像向外辐射 */
  background: radial-gradient(
    circle,
    transparent 0%,
    transparent 52%,
    var(--friend-glow-color) 61%,
    var(--friend-glow-color) 66%,
    transparent 76%
  );
  animation: friend-radiate var(--friend-glow-duration) var(--friend-glow-easing) infinite;
}

/* 拖动中：辐射暂停并淡掉（"在位置上固定时"才往外辐射） */
.friend-avatar-host.is-dragging .friend-avatar__glow {
  opacity: 0;
}

.friend-avatar-host.is-dragging .friend-avatar__glow-ring {
  animation-play-state: paused;
}

.friend-avatar__icon {
  position: relative;
  z-index: 1;
  width: var(--friend-glyph-size);
  height: var(--friend-glyph-size);
  color: var(--friend-icon-color);
  filter: var(--friend-icon-shadow);
}

.friend-avatar-host.is-interactive .friend-avatar__icon {
  cursor: pointer;
}

:global(html.dark .friend-avatar__icon) {
  color: var(--friend-icon-color-dark);
}

@keyframes friend-radiate {
  0% {
    transform: scale(var(--friend-glow-start));
    opacity: 1;
  }
  45% {
    opacity: 0.8;
  }
  100% {
    transform: scale(var(--friend-glow-end));
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .friend-avatar__glow-ring {
    animation: none;
  }
}
</style>
