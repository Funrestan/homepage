<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import AnimationConfig from '../configs/animation'
import DonateConfig from '../configs/donate'
import PhysicsConfig from '../configs/physics'
import PhysicsItem from './PhysicsItem.vue'
import { findDonateLink } from '../composables/donateLink'
import { sampleDampedSpring } from '../composables/dampedSpring'
import {
  setSoftPhysicsFree,
  triggerSoftPhysicsSourceRipple,
} from '../composables/useSoftPhysics'

type Point = { x: number; y: number }
/** 按钮飞行的方向（单位向量）与距离，内容块据此继承动量。 */
type Momentum = Point & { distance: number }

const emit = defineEmits<{
  close: []
}>()

const donate = AnimationConfig.donate
const donateIcon = findDonateLink()?.icon ?? 'tabler:gift'
const channels = DonateConfig.channels

const flightRoot = ref<HTMLElement | null>(null)
const flightVisual = ref<HTMLElement | null>(null)
const panelPhysics = ref<{ getElement: () => HTMLElement | null } | null>(null)
const panelRoot = ref<HTMLElement | null>(null)
const panelContent = ref<HTMLElement | null>(null)
const flightVisible = ref(false)
const panelVisible = ref(false)
const interactive = ref(false)
const flightStyle = ref({ left: '0px', top: '0px' })
const panelStyle = ref({ left: '0px', top: '0px' })
const scatterTimers: number[] = []
/** 当前选中的渠道：null = 显示渠道列表，否则显示该渠道的收款码 */
const activeChannel = ref<(typeof channels)[number] | null>(null)
const brokenQr = ref<string[]>([])

const frameTransform = (dx: number, dy: number, rotate: number, scale: number) =>
  `translate(-50%, -50%) translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0)`
  + ` rotate(${rotate.toFixed(2)}deg) scale(${scale.toFixed(4)})`

/**
 * 一次缓动走完全程：单段关键帧，中途不换 easing。
 * （曾经在 56% 处插中间帧并切换 easing，位移会在那里断一次速度，看起来像移动了两段。）
 */
const runFlight = async (
  from: Point,
  to: Point,
  endScale: number,
  endRotate: number,
  duration: number,
  easing: string,
) => {
  const root = flightRoot.value
  if (!root) return
  const animation = root.animate([
    { offset: 0, transform: frameTransform(0, 0, 0, 1) },
    {
      offset: 1,
      transform: frameTransform(to.x - from.x, to.y - from.y, endRotate, endScale),
    },
  ], {
    duration,
    easing,
    fill: 'forwards',
  })
  await animation.finished.catch(() => undefined)
}

/**
 * 阻尼弹簧的收尾时长决定了按钮该在多早消失，所以把它传进来。
 * 按钮在弹簧收尾时长的前 buttonFadeOffset 之内完全消失。
 */
const fadeFlightOut = async (panelSettleTime: number) => {
  const visual = flightVisual.value
  if (!visual) {
    flightVisible.value = false
    return
  }
  const animation = visual.animate([
    { offset: 0, opacity: 1, filter: 'blur(0px)', transform: 'scale(1)' },
    {
      offset: 1,
      opacity: 0,
      filter: `blur(${donate.buttonFadeBlur}px)`,
      transform: `scale(${donate.buttonFadeScale})`,
    },
  ], {
    duration: Math.max(60, panelSettleTime * donate.buttonFadeOffset),
    delay: donate.panelDelay,
    easing: donate.buttonFadeEasing,
    fill: 'forwards',
  })
  await animation.finished.catch(() => undefined)
  flightVisible.value = false
}

const playContent = (baseDelay: number) => {
  const items = Array.from(
    panelContent.value?.querySelectorAll<HTMLElement>('[data-donate-item]') ?? [],
  )
  items.forEach((item, index) => {
    item.animate([
      {
        offset: 0,
        opacity: 0,
        filter: `blur(${donate.contentStartBlur}px)`,
        transform: `translate3d(0, ${donate.contentOffsetY}px, 0) scale(${donate.contentStartScale})`,
      },
      { offset: 1, opacity: 1, filter: 'blur(0px)', transform: 'translate3d(0, 0, 0) scale(1)' },
    ], {
      duration: donate.contentDuration,
      delay: baseDelay + index * donate.contentStagger,
      easing: donate.contentEasing,
      fill: 'backwards',
    })
  })
}

// 内层自己做弹簧位移与缩放；居中由宿主（物理条目）的 translate(-50%,-50%) 负责
const panelTransform = (scale: number, travelX: number, travelY: number) =>
  `translate3d(${travelX.toFixed(2)}px, ${travelY.toFixed(2)}px, 0)`
  + ` scale(${scale.toFixed(4)})`

const delay = (duration: number) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, Math.max(0, duration))
})

/**
 * Vite 会把 public/ 目录映射到站点根：配置里写 `public/donate-wechat.png` 在 dev 能加载，
 * 但生产构建后只有 `/donate-wechat.png` 存在。这里统一归一化，配置怎么写都不至于上线破图。
 */
const resolveQrPath = (path: string) => path.replace(/^(?:\.?\/)?public\//, '/')

/** 收款码能不能用：路径为空或图片加载失败都算没有 */
const channelQr = (channel: (typeof channels)[number]) => {
  if (!channel.qr) return ''
  const src = resolveQrPath(channel.qr)
  return brokenQr.value.includes(src) ? '' : src
}

const markQrBroken = (channel: (typeof channels)[number]) => {
  brokenQr.value.push(resolveQrPath(channel.qr))
}

/**
 * 收款码是"透明底 + 白色墨点"（支付宝、微信导出的图就是这种），同一个图在两种主题下表现相反：
 * - 亮色主题：码框是浅色底 ⇒ 白码白底完全看不见 ⇒ 把墨点涂黑；
 * - 暗色主题：码框是深色底 ⇒ 白码本来就很清楚 ⇒ 原样显示。
 * 但很多收款码中间压了个 logo（微信那张就是头像）：整张涂黑会把 logo 也变成黑饼，
 * 所以这里顺便量一下中央那块"实心不透明"的区域（= logo）的半径，让 CSS 在涂黑层上挖洞，
 * 透出下层原图的 logo。支付宝那张中央没有实心区域（实测 0%），就不会挖洞、整张涂黑。
 * 结果按渠道名记录——不要用 img.src 当键，它返回的是绝对 URL，和模板里的相对路径对不上。
 */
const QR_SAMPLE = 32
const QR_CENTER_RATIO = 0.3
const QR_TRANSPARENT_THRESHOLD = 0.12
const QR_LOGO_THRESHOLD = 0.06

type QrFacts = {
  /** 底是透明的（亮色主题下需要涂黑） */
  transparent: boolean
  /** 中央 logo 的半径，相对 closest-side 的百分比；0 = 没检测到 logo */
  logoRadius: number
}

const qrImage = ref<HTMLImageElement | null>(null)
const qrFacts = ref<Record<string, QrFacts>>({})

const analyzeQrBackground = (
  channel: (typeof channels)[number],
  image: HTMLImageElement | null,
) => {
  if (!channel.qr || channel.name in qrFacts.value) return
  if (!image || !image.complete || image.naturalWidth === 0) return
  try {
    const canvas = document.createElement('canvas')
    canvas.width = QR_SAMPLE
    canvas.height = QR_SAMPLE
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return
    context.drawImage(image, 0, 0, QR_SAMPLE, QR_SAMPLE)
    const { data } = context.getImageData(0, 0, QR_SAMPLE, QR_SAMPLE)

    const center = (QR_SAMPLE - 1) / 2
    const centerRadius = QR_SAMPLE * QR_CENTER_RATIO
    let transparent = 0
    let logoPixels = 0
    let logoRadius = 0

    for (let y = 0; y < QR_SAMPLE; y += 1) {
      for (let x = 0; x < QR_SAMPLE; x += 1) {
        const index = (y * QR_SAMPLE + x) * 4
        const alpha = data[index + 3] ?? 255
        if (alpha < 16) {
          transparent += 1
          continue
        }
        // 中央那块"实心（alpha 接近满）且不是白"的像素就是 logo；半透明的码点会因采样被平均掉，不会误判
        const luminance = 0.299 * (data[index] ?? 0)
          + 0.587 * (data[index + 1] ?? 0)
          + 0.114 * (data[index + 2] ?? 0)
        const radius = Math.hypot(x - center, y - center)
        if (radius <= centerRadius && alpha > 200 && luminance < 200) {
          logoPixels += 1
          logoRadius = Math.max(logoRadius, radius)
        }
      }
    }

    const hasLogo = logoPixels / (Math.PI * centerRadius ** 2) > QR_LOGO_THRESHOLD
    qrFacts.value[channel.name] = {
      transparent: transparent / (QR_SAMPLE * QR_SAMPLE) > QR_TRANSPARENT_THRESHOLD,
      // 只留很小的余量：洞越小越不伤码点，而 logo 那块本来就是生成器预留/冗余的安全区
      logoRadius: hasLogo
        ? Math.min(56, (logoRadius + QR_SAMPLE * 0.02) / (QR_SAMPLE / 2) * 100)
        : 0,
    }
  } catch {
    // 跨域图片读不到像素：按原样显示
  }
}

/**
 * 切到收款码视图后主动检查一次：图片可能命中缓存、不再（或来不及）触发 load 事件，
 * 那种情况下只挂 load 监听会一直等不到，码就一直保持"透明底白码"看不清。
 */
const inspectQrInk = (channel: (typeof channels)[number] | null) => {
  if (!channel?.qr) return
  const image = qrImage.value
  if (!image) return
  if (image.complete && image.naturalWidth > 0) {
    analyzeQrBackground(channel, image)
    return
  }
  image.addEventListener('load', () => analyzeQrBackground(channel, image), { once: true })
}

const switchView = async (next: (typeof channels)[number] | null) => {
  if (next === activeChannel.value) return
  const view = donate.channelSwitch
  const current = panelContent.value?.querySelector<HTMLElement>('[data-donate-view]')
  const outgoing = current?.animate([
    {
      offset: 0,
      opacity: 1,
      filter: 'blur(0px)',
      transform: 'translate3d(0, 0, 0) scale(1)',
    },
    {
      offset: 1,
      opacity: 0,
      filter: `blur(${view.blur}px)`,
      transform: `translate3d(0, ${-view.offsetY / 2}px, 0) scale(${view.scale})`,
    },
  ], {
    duration: view.fadeOutDuration,
    easing: 'ease-in',
    fill: 'forwards',
  })
  await outgoing?.finished.catch(() => undefined)

  // 两个视图高度不同（收款码视图更高），用 height 过渡把尺寸变化也做顺
  const host = panelRoot.value
  const fromHeight = host?.offsetHeight ?? 0
  activeChannel.value = next
  await nextTick()
  inspectQrInk(next)

  const incoming = panelContent.value?.querySelector<HTMLElement>('[data-donate-view]')
  const toHeight = host?.offsetHeight ?? 0
  if (host && fromHeight > 0 && toHeight > 0 && Math.abs(fromHeight - toHeight) > 1) {
    void host.animate([
      { height: `${fromHeight}px` },
      { height: `${toHeight}px` },
    ], {
      duration: view.resizeDuration,
      easing: view.easing,
    }).finished.catch(() => undefined)
  }

  incoming?.animate([
    {
      offset: 0,
      opacity: 0,
      filter: `blur(${view.blur}px)`,
      transform: `translate3d(0, ${view.offsetY}px, 0) scale(${view.scale})`,
    },
    { offset: 1, opacity: 1, filter: 'blur(0px)', transform: 'translate3d(0, 0, 0) scale(1)' },
  ], {
    duration: view.fadeInDuration,
    easing: view.easing,
    fill: 'backwards',
  })
}

const selectChannel = (channel: (typeof channels)[number]) => {
  void switchView(channel)
}

const backToChannels = () => {
  void switchView(null)
}

/**
 * 窄屏（全屏布局）下内容块弹开时：解锁全部可碰撞组件（不再归位），
 * 由块自己发出一圈大范围冲击波把它们崩飞，稍后一起隐形并留在原地，直到窗口关闭。
 */
const startScatter = (center: Point) => {
  const scatter = donate.scatter
  if (!scatter.enable) return
  if (!window.matchMedia('(max-width: 767px)').matches) return

  setSoftPhysicsFree(true)
  triggerSoftPhysicsSourceRipple(
    panelPhysics.value?.getElement() ?? null,
    center.x,
    center.y,
    scatter.speed,
    {
      radiusScale: scatter.radiusScale,
      forceScale: scatter.forceScale,
      radialScale: scatter.radialScale,
      depthScale: scatter.depthScale,
      bypassInterval: true,
    },
  )
  scatterTimers.push(window.setTimeout(() => {
    document.documentElement.classList.add('donate-scatter')
  }, scatter.delay))
}

/** 收起时恢复：元素复现，并重新开始归位。 */
const endScatter = () => {
  while (scatterTimers.length > 0) window.clearTimeout(scatterTimers.pop())
  document.documentElement.classList.remove('donate-scatter')
  setSoftPhysicsFree(false)
}

/** 取 cubic-bezier 终点斜率：按钮到达中心那一刻的瞬时速度倍数（无解析式时退回 1 = 平均速度）。 */
const cubicBezierEndSlope = (easing: string) => {
  const match = /cubic-bezier\(([^)]*)\)/.exec(easing)
  if (!match?.[1]) return 1
  const values = match[1].split(',').map((part) => Number.parseFloat(part))
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) return 1
  const x2 = values[2] ?? 0
  const y2 = values[3] ?? 1
  const span = 1 - x2
  return span <= 0.0001 ? 1 : (1 - y2) / span
}

/**
 * 内容块抢在按钮落点前 panelLead 毫秒启动，位移与缩放挂在同一根阻尼弹簧上：
 * 位移的初速直接取按钮到达中心时的速度（速度继承），缩放的初速取起始偏离的比例，
 * 之后每一次过冲都由 panelSpring 的阻尼系数与频率算出来，振幅衰到阈值以内就一步到位。
 */
const openPanel = async (momentum: Momentum, center: Point) => {
  panelVisible.value = true
  await nextTick()
  const root = panelRoot.value
  if (!root) return

  const spring = donate.panelSpring
  const travel = Math.min(donate.panelTravel, momentum.distance * donate.panelTravelDistanceRatio)
  const omega = 2 * Math.PI * spring.frequency
  const scaleOffset = donate.panelStartScale - 1
  const arrivalVelocity = (momentum.distance / donate.flightDuration)
    * cubicBezierEndSlope(donate.flightEasing)

  const track = sampleDampedSpring({
    scale: {
      offset: scaleOffset,
      velocity: donate.panelScaleLaunch * omega * Math.abs(scaleOffset),
    },
    travel: {
      offset: travel * donate.panelTravelStart,
      velocity: arrivalVelocity * 1000 * donate.panelTravelLaunch,
    },
  }, spring)

  const scaleValues = track.values.scale ?? []
  const travelValues = track.values.travel ?? []
  const frames: Keyframe[] = track.times.map((time, index) => {
    const reveal = Math.min(1, time / Math.max(1, donate.panelRevealDuration))
    const easedReveal = 1 - (1 - reveal) ** 3
    const distance = travelValues[index] ?? 0
    return {
      offset: time / track.settleTime,
      opacity: donate.panelStartOpacity + (1 - donate.panelStartOpacity) * easedReveal,
      filter: `blur(${(donate.panelStartBlur * (1 - easedReveal)).toFixed(2)}px)`,
      transform: panelTransform(
        1 + (scaleValues[index] ?? 0),
        momentum.x * distance,
        momentum.y * distance,
      ),
      easing: 'linear',
    }
  })

  const animation = root.animate(frames, {
    duration: track.settleTime,
    delay: donate.panelDelay,
    fill: 'backwards',
  })

  playContent(donate.panelDelay + donate.contentDelay)
  void fadeFlightOut(track.settleTime)
  // 弹开瞬间：窄屏下解锁并崩飞其它可碰撞组件
  startScatter(center)
  await animation.finished.catch(() => undefined)
  interactive.value = true
}

/** 供父组件调用：按钮实体从原位缓动到右侧内容块中心，随后内容块渐显放大。 */
const openFrom = async (origin: Point, target: Point) => {
  flightStyle.value = { left: `${origin.x}px`, top: `${origin.y}px` }
  panelStyle.value = { left: `${target.x}px`, top: `${target.y}px` }
  panelVisible.value = false
  interactive.value = false
  flightVisible.value = true
  await nextTick()

  const dx = target.x - origin.x
  const dy = target.y - origin.y
  const distance = Math.hypot(dx, dy)
  const momentum: Momentum = distance > 1
    ? { x: dx / distance, y: dy / distance, distance }
    : { x: 0, y: 0, distance: 0 }
  const lead = Math.max(0, Math.min(donate.panelLead, donate.flightDuration - 80))

  const flight = runFlight(
    origin,
    target,
    donate.flightScale,
    donate.flightRotate,
    donate.flightDuration,
    donate.flightEasing,
  )
  const panel = (async () => {
    if (lead > 0) await delay(donate.flightDuration - lead)
    await openPanel(momentum, target)
  })()
  await Promise.all([flight, panel])
}

/**
 * 收起：块与按钮挂在同一根 closeSpring 上——块的行程是按钮回程距离的 closeFollowRatio 倍，
 * 所以初期两者完全同步（块跟着按钮往回缩、边缩边淡出），按钮则一路过冲过落点再弹回来归位。
 * 调用 hideFlight 前，按钮实体会停在落点上。
 */
const closeTo = async (from: Point, to: Point) => {
  interactive.value = false
  // 收起即恢复：崩飞过的元素复现并重新归位
  endScatter()
  const spring = donate.closeSpring
  const dx = to.x - from.x
  const dy = to.y - from.y
  const distance = Math.hypot(dx, dy)
  const direction = distance > 1 ? { x: dx / distance, y: dy / distance } : { x: 0, y: 0 }
  const omega = 2 * Math.PI * spring.frequency
  const followDistance = distance * donate.closeFollowRatio
  const scaleOffset = 1 - donate.closeEndScale

  const track = sampleDampedSpring({
    button: { offset: -distance, velocity: donate.returnLaunch * omega * distance },
    blockTravel: { offset: -followDistance, velocity: 0 },
    blockScale: { offset: scaleOffset, velocity: 0 },
  }, spring)

  const buttonValues = track.values.button ?? []
  const blockTravelValues = track.values.blockTravel ?? []
  const blockScaleValues = track.values.blockScale ?? []

  flightStyle.value = { left: `${from.x}px`, top: `${from.y}px` }
  flightVisible.value = true
  await nextTick()

  const flightAnimation = flightRoot.value?.animate(
    track.times.map((time, index) => {
      const travelled = distance + (buttonValues[index] ?? 0)
      return {
        offset: time / track.settleTime,
        transform: frameTransform(direction.x * travelled, direction.y * travelled, 0, 1),
        easing: 'linear',
      }
    }),
    { duration: track.settleTime, fill: 'forwards' },
  )

  flightVisual.value?.animate([
    { offset: 0, opacity: 0 },
    { offset: 1, opacity: 1 },
  ], {
    duration: donate.returnFadeDuration,
    easing: 'ease-out',
    fill: 'backwards',
  })

  const fadeWindow = Math.max(1, track.settleTime * donate.closeFadeOffset)
  const panelAnimation = panelRoot.value?.animate(
    track.times.map((time, index) => {
      const progress = Math.min(1, time / fadeWindow)
      const eased = progress * progress * (3 - 2 * progress)
      const travelled = followDistance + (blockTravelValues[index] ?? 0)
      return {
        offset: time / track.settleTime,
        opacity: 1 - eased,
        filter: `blur(${(donate.closeEndBlur * eased).toFixed(2)}px)`,
        transform: panelTransform(
          Math.max(0.02, donate.closeEndScale + (blockScaleValues[index] ?? 0)),
          direction.x * travelled,
          direction.y * travelled,
        ),
        easing: 'linear',
      }
    }),
    { duration: track.settleTime, fill: 'forwards' },
  )

  await Promise.all([
    flightAnimation?.finished.catch(() => undefined) ?? Promise.resolve(),
    panelAnimation?.finished.catch(() => undefined) ?? Promise.resolve(),
  ])
  panelVisible.value = false
}

const hideFlight = () => {
  flightVisible.value = false
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || !interactive.value) return
  emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  endScatter()
})

defineExpose({ openFrom, closeTo, hideFlight })
</script>

<template>
  <Teleport to="body">
    <span
      v-if="flightVisible"
      ref="flightRoot"
      class="donate-flight"
      :style="flightStyle"
      aria-hidden="true"
    >
      <span ref="flightVisual" class="donate-flight__visual">
        <Icon :icon="donateIcon" class="donate-flight__icon" />
      </span>
    </span>

    <PhysicsItem
      v-if="panelVisible"
      ref="panelPhysics"
      :mass="PhysicsConfig.presets.container.mass"
      :influence="PhysicsConfig.presets.container.influence"
      :cooldown="PhysicsConfig.presets.container.cooldown"
      :settle-collision-cooldown="PhysicsConfig.presets.container.settleCollisionCooldown"
      :highlight="false"
      drag-ignore-selector="a, button, .donate-channel"
      class="donate-panel-host"
      :style="panelStyle"
    >
      <div
        ref="panelRoot"
        class="donate-panel bg-white/50 border-white/50 dark:bg-black/60
               dark:border-gray-700/50 backdrop-blur-2xl border"
        :class="{ 'is-interactive': interactive, 'is-qr': activeChannel !== null }"
        role="dialog"
        aria-modal="true"
        :aria-label="DonateConfig.title"
      >
        <button
          type="button"
          class="donate-panel__close"
          :aria-label="DonateConfig.closeLabel"
          :title="DonateConfig.closeLabel"
          @click="emit('close')"
        >
          <Icon icon="mingcute:close-line" />
        </button>

        <div ref="panelContent" class="donate-panel__content">
          <header class="donate-panel__header" data-donate-item>
            <span class="donate-panel__badge" aria-hidden="true">
              <Icon :icon="donateIcon" />
            </span>
            <div class="donate-panel__intro">
              <h2>{{ DonateConfig.title }}</h2>
              <p>{{ DonateConfig.subtitle }}</p>
            </div>
          </header>

          <template v-if="!activeChannel">
            <ul class="donate-panel__channels" data-donate-view>
              <li
                v-for="channel in channels"
                :key="channel.name"
                class="donate-channel"
                data-donate-item
                :style="{
                  '--icon-hover': channel.hoverColor || undefined,
                }"
              >
                <button
                  type="button"
                  class="donate-channel__body"
                  @click="selectChannel(channel)"
                >
                  <span class="donate-channel__mark" aria-hidden="true">
                    <Icon :icon="channel.icon" />
                  </span>
                  <span class="donate-channel__text">
                    <strong>{{ channel.name }}</strong>
                    <small>{{ channel.detail }}</small>
                  </span>
                  <span class="donate-channel__hint" aria-hidden="true">
                    <Icon icon="mingcute:right-line" />
                  </span>
                </button>
              </li>
            </ul>

            <p v-if="DonateConfig.note" class="donate-panel__note" data-donate-item>
              {{ DonateConfig.note }}
            </p>
          </template>

          <!-- 收款码视图：点选项后列表淡出、这里淡入；点任意处返回列表 -->
          <section
            v-else
            class="donate-panel__qr-view"
            data-donate-view
            data-donate-item
            role="button"
            tabindex="0"
            @click="backToChannels"
            @keydown.enter="backToChannels"
            @keydown.space.prevent="backToChannels"
          >
            <p class="donate-panel__qr-title">{{ activeChannel.name }}</p>
            <div class="donate-panel__qr-frame">
              <span v-if="channelQr(activeChannel)" class="donate-panel__qr-image">
                <!-- 下层原图：亮色主题下白码白底看不见，正好用来透出中间的 logo（头像） -->
                <img
                  class="donate-panel__qr-source"
                  :src="channelQr(activeChannel)"
                  alt=""
                  aria-hidden="true"
                  draggable="false"
                  @error="markQrBroken(activeChannel)"
                >
                <!-- 上层：透明底的码在亮色主题下涂黑；有 logo 时按实测半径挖洞 -->
                <img
                  ref="qrImage"
                  class="donate-panel__qr-layer"
                  :src="channelQr(activeChannel)"
                  :class="{
                    'is-transparent': qrFacts[activeChannel.name]?.transparent,
                    'has-logo': (qrFacts[activeChannel.name]?.logoRadius ?? 0) > 0,
                  }"
                  :style="{ '--qr-logo-radius': `${qrFacts[activeChannel.name]?.logoRadius ?? 0}%` }"
                  :alt="activeChannel.name"
                  draggable="false"
                  @error="markQrBroken(activeChannel)"
                >
              </span>
              <span v-else class="donate-panel__qr-pending">
                <Icon :icon="activeChannel.icon" aria-hidden="true" />
                {{ DonateConfig.qrPendingLabel }}
              </span>
            </div>
            <a
              v-if="activeChannel.url && activeChannel.url !== '#'"
              class="donate-panel__qr-open"
              :href="activeChannel.url"
              target="_blank"
              rel="noopener noreferrer"
              @click.stop
            >{{ DonateConfig.qrOpenLabel }}</a>
            <p class="donate-panel__qr-back">{{ DonateConfig.qrBackLabel }}</p>
          </section>
        </div>
      </div>
    </PhysicsItem>
  </Teleport>
</template>

<style scoped>
.donate-flight {
  position: fixed;
  z-index: 58;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transform: translate(-50%, -50%);
  pointer-events: none;
  will-change: transform;
}

.donate-flight__visual {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: rgb(55 65 81);
  will-change: transform, opacity, filter;
}

.donate-flight__icon {
  display: block;
  width: 1.5rem;
  height: 1.5rem;
  filter: drop-shadow(0 8px 16px rgb(26 96 143 / 22%));
}

:global(html.dark .donate-flight__visual) {
  color: rgb(209 213 219);
}

/* 内容块本体是一个物理条目：可拖动、有碰撞箱（质量等沿用 container 预设）。
   物理位移在宿主上用 --physics-* 驱动，弹簧弹出动画在内层 .donate-panel 上，互不打架。 */
.donate-panel-host {
  position: fixed;
  z-index: 55;
  /* 物理条目默认 preserve-3d，会让子元素的 backdrop-filter 失效（毛玻璃看起来就"全透明"了），这里摊平 */
  transform-style: flat;
  transform: translate(-50%, -50%)
    translate3d(var(--physics-x), var(--physics-y), var(--physics-z))
    rotate(var(--physics-rotate))
    scale(var(--physics-scale-x), var(--physics-scale-y));
}

.donate-panel {
  display: flex;
  flex-direction: column;
  width: min(30rem, calc(100vw - 2.5rem));
  max-height: min(82vh, 36rem);
  padding: 1.6rem 1.7rem 1.4rem;
  /* 背景 / 描边 / 毛玻璃与左侧栏同款：bg-white/50 + border-white/50 + backdrop-blur-2xl，
     写在模板的类名里，改一处两边一起变 */
  border-radius: 1.5rem;
  color: rgb(31 41 55);
  box-shadow: 0 22px 55px rgb(0 0 0 / 25%);
  transform-origin: center;
  pointer-events: none;
  will-change: transform, opacity, filter;
}

.donate-panel.is-interactive {
  pointer-events: auto;
}

/* 收款码视图：放宽高度上限，并把码框放大，保证扫得清 */
.donate-panel.is-qr {
  max-height: min(96vh, 52rem);
}

:global(html.dark .donate-panel) {
  color: rgb(226 232 240);
  box-shadow: 0 22px 55px rgb(0 0 0 / 45%);
}

.donate-panel__close {
  position: absolute;
  top: 0.85rem;
  right: 0.85rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.9rem;
  height: 1.9rem;
  border: 1px solid rgb(148 163 184 / 32%);
  border-radius: 999px;
  color: inherit;
  background: rgb(255 255 255 / 46%);
  cursor: pointer;
  transition:
    color 220ms ease,
    border-color 220ms ease,
    transform 220ms cubic-bezier(0.2, 1.2, 0.35, 1),
    background-color 220ms ease;
}

.donate-panel__close:hover {
  border-color: rgb(94 188 255 / 52%);
  color: rgb(17 92 151);
  transform: scale(1.08);
}

:global(html.dark .donate-panel__close) {
  border-color: rgb(125 211 252 / 22%);
  background: rgb(15 23 42 / 52%);
}

:global(html.dark .donate-panel__close:hover) {
  color: rgb(147 213 255);
}

.donate-panel__content {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 1rem;
  /* 内容块内部拒绝滚动，并且不出现滚动条（内容超高时直接裁掉，不产生滚动区域） */
  overflow: hidden;
  overscroll-behavior: none;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.donate-panel__content::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}

.donate-panel__header {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  padding-right: 2.1rem;
}

.donate-panel__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.6rem;
  height: 2.6rem;
  border-radius: 999px;
  color: rgb(17 92 151);
  background: rgb(148 205 255 / 28%);
  box-shadow: inset 0 0 12px rgb(255 255 255 / 46%);
  font-size: 1.35rem;
}

.donate-panel__intro h2 {
  margin: 0;
  font-size: 1.12rem;
  font-weight: 640;
  letter-spacing: 0.01em;
}

.donate-panel__intro p {
  margin: 0.28rem 0 0;
  color: rgb(71 85 105);
  font-size: 0.82rem;
  line-height: 1.5;
}

:global(html.dark .donate-panel__intro p) {
  color: rgb(148 163 184);
}

.donate-panel__channels {
  display: flex;
  margin: 0;
  padding: 0;
  flex-direction: column;
  gap: 0.55rem;
  list-style: none;
}

.donate-channel {
  display: flex;
  align-items: center;
  border: 1px solid rgb(148 163 184 / 22%);
  border-radius: 1rem;
  background: rgb(255 255 255 / 42%);
  transition:
    border-color 240ms ease,
    background-color 240ms ease,
    transform 240ms cubic-bezier(0.2, 1.2, 0.35, 1);
}

.donate-channel:hover {
  border-color: rgb(94 188 255 / 46%);
  background: rgb(255 255 255 / 66%);
  transform: translateY(-1px);
}

:global(html.dark .donate-channel) {
  border-color: rgb(125 211 252 / 14%);
  background: rgb(15 23 42 / 42%);
}

:global(html.dark .donate-channel:hover) {
  background: rgb(15 23 42 / 68%);
}

/* 内边距放在按钮上：让"看得见的整行"和"点得着的区域"完全重合
   （否则按在行的 padding 上会出现 hover 亮着、点不响应、还把整块拖走） */
.donate-channel__body {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 0.7rem;
  padding: 0.55rem 0.7rem;
  border: 0;
  color: inherit;
  background: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
  appearance: none;
}

.donate-channel__hint {
  display: inline-flex;
  align-items: center;
  margin-left: auto;
  color: rgb(148 163 184);
  font-size: 1.05rem;
  transition: color 240ms ease, transform 240ms cubic-bezier(0.2, 1.2, 0.35, 1);
}

.donate-channel:hover .donate-channel__hint {
  color: rgb(56 152 224);
  transform: translateX(2px);
}

.donate-channel__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.9rem;
  height: 1.9rem;
  flex: 0 0 auto;
  border-radius: 999px;
  color: var(--icon-default, currentColor);
  background: rgb(148 205 255 / 20%);
  font-size: 1.15rem;
  transition: color 240ms ease, background-color 240ms ease;
}

.donate-channel:hover .donate-channel__mark {
  color: var(--icon-hover, currentColor);
  background: rgb(148 205 255 / 32%);
}

.donate-channel__text {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.12rem;
}

.donate-channel__text strong {
  font-size: 0.9rem;
  font-weight: 600;
}

.donate-channel__text small {
  overflow: hidden;
  color: rgb(100 116 139);
  font-size: 0.74rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:global(html.dark .donate-channel__text small) {
  color: rgb(148 163 184);
}

/* —— 收款码视图（点选项后从列表淡入到这里） —— */
.donate-panel__qr-view {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  padding: 0.2rem 0 0.1rem;
  cursor: pointer;
  outline: none;
}

.donate-panel__qr-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 620;
}

.donate-panel__qr-frame {
  display: flex;
  align-items: center;
  justify-content: center;
  width: min(11.5rem, 46vw);
  aspect-ratio: 1;
  padding: 0.5rem;
  border: 1px solid rgb(148 163 184 / 28%);
  border-radius: 1rem;
  background: rgb(255 255 255 / 62%);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 56%);
}

/* 收款码态：码框尽量放大；同时用"面板内宽"和"剩余高度"兜住矮屏，避免被 overflow: hidden 裁掉 */
.donate-panel.is-qr .donate-panel__qr-frame {
  width: max(8rem, min(20rem, calc(100vw - 6.5rem), calc(96vh - 12rem)));
  padding: 0.85rem;
  border-radius: 1.2rem;
}

.donate-panel__qr-image {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
}

.donate-panel__qr-image img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border-radius: 0.5rem;
  object-fit: contain;
  transition: filter 200ms ease;
}

/* 透明底的码 + 亮色主题 = 白码白底看不见：给上层涂黑（只改墨色，图案与 alpha 都不动）。
   暗色主题下码框是深色底，白码本就清楚，保持原样即可，所以用 html:not(.dark) 限定。 */
:global(html:not(.dark) .donate-panel__qr-image .donate-panel__qr-layer.is-transparent) {
  filter: brightness(0);
}

/* 中间压了 logo（头像）的码：在涂黑层上按实测半径挖洞，透出下层原图的 logo。
   没检测到 logo 的码（例如支付宝那张）不会走到这里，整张涂黑、不会挖掉码点。 */
:global(html:not(.dark) .donate-panel__qr-image .donate-panel__qr-layer.is-transparent.has-logo) {
  -webkit-mask-image: radial-gradient(
    circle closest-side at 50% 50%,
    transparent 0 var(--qr-logo-radius, 0%),
    #000 calc(var(--qr-logo-radius, 0%) + 6%)
  );
  mask-image: radial-gradient(
    circle closest-side at 50% 50%,
    transparent 0 var(--qr-logo-radius, 0%),
    #000 calc(var(--qr-logo-radius, 0%) + 6%)
  );
}

.donate-panel__qr-pending {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.45rem;
  color: rgb(148 163 184);
  font-size: 0.68rem;
  text-align: center;
}

.donate-panel__qr-pending > svg {
  font-size: 1.6rem;
}

/* 暗色主题：码框跟随主题的深色底，白码直接可见；透明度压到 38%，
   免得和面板自身的 bg-black/60 叠起来太实（第二级不要那么不透明） */
:global(html.dark .donate-panel__qr-frame) {
  border-color: rgb(125 211 252 / 16%);
  background: rgb(15 23 42 / 38%);
  box-shadow: inset 0 1px 0 rgb(148 197 255 / 12%);
}

.donate-panel__qr-open {
  color: rgb(17 92 151);
  font-size: 0.78rem;
  text-decoration: none;
  border-bottom: 1px solid rgb(17 92 151 / 30%);
  transition: color 240ms ease, border-color 240ms ease;
}

.donate-panel__qr-open:hover {
  color: rgb(56 152 224);
  border-color: rgb(56 152 224 / 50%);
}

:global(html.dark .donate-panel__qr-open) {
  color: rgb(147 213 255);
  border-color: rgb(147 213 255 / 30%);
}

.donate-panel__qr-back {
  margin: 0;
  color: rgb(148 163 184);
  font-size: 0.68rem;
}

.donate-panel__note {
  margin: 0;
  color: rgb(100 116 139);
  font-size: 0.72rem;
  line-height: 1.5;
}

:global(html.dark .donate-panel__note) {
  color: rgb(148 163 184);
}

@media (prefers-reduced-motion: reduce) {
  .donate-panel,
  .donate-flight {
    will-change: auto;
  }
}
</style>
