/**
 * 开发者小球引擎（DOM 版，不走 canvas）。
 *
 * 为什么不用 useSoftPhysics：这套球要受**重力和磁力**（被友链球吸住），而且必须
 * **只和同类小球碰撞**——不能推动页面上任何其它物理组件。所以它是一套独立的小系统：
 * 固定 60fps 步长推进、直接写每个小球元素的 transform，位置不进 Vue 的响应式（只写 DOM）。
 *
 * 生命周期：begin() 生成一批（每个开发者一颗，从屏幕外下方升起）→ 友链球归位时 release()
 * （磁力消失，自由落体掉出屏幕 → 淡出销毁）。
 */
import { ref, shallowRef } from 'vue'
import DeveloperConfig, { type DeveloperOrb } from '../configs/developers'
import PhysicsConfig from '../configs/physics'
import { onSoftPhysicsSweep, onSoftPhysicsWave } from './useSoftPhysics'

/** 友链球此刻的位置与半径（每帧现读，所以它被拖动时磁铁跟着走） */
export type DeveloperMagnet = { x: number; y: number; radius: number }

/** 给模板用的只读视图（位置不在这里，位置由引擎直接写 DOM） */
export type DeveloperOrbView = {
  id: number
  name: string
  info: string
  url: string
  avatar: string
  diameter: number
  /** 他自己的大小倍数（0–2 的浮点数） */
  sizeScale: number
  /** 是否戴皇冠（球上多头饰 + 整颗球一圈环绕光效） */
  crown: boolean
  /** 皇冠专属的特殊描述（留空 = 不显示） */
  crownInfo: string
}

type OrbState = {
  id: number
  view: DeveloperOrbView
  radius: number
  /** 半径²：球球碰撞按面积分摊，大的更"重" */
  area: number
  x: number
  y: number
  vx: number
  vy: number
  swirlSign: number
  /** 出场延迟（ms），倒计时到 0 才开始进物理 */
  delay: number
  /** 是否已经进过画面（没进过就不判"掉出屏幕"，否则刚生成就被销毁） */
  entered: boolean
  /** >0 = 正在淡出，倒计时结束就移除 */
  dying: number
  /** 被扫掠击飞的窗口：这段时间不受重力/磁力/墙体影响，纯直线飞出去（允许穿模） */
  knockUntil: number
  alive: boolean
  element: HTMLElement | null
}

/** 场上其它物理组件（文字、头像、赞助面板…）：拿来和小球做互相碰撞 */
type Obstacle = {
  element: HTMLElement
  width: number
  height: number
  x: number
  y: number
  vx: number
  vy: number
}

/** 页面波纹的本地副本（吃冲击波用） */
type LocalWave = {
  x: number
  y: number
  force: number
  radiusScale: number
  radialScale: number
  startAt: number
  touched: Set<number>
}

const FIXED_STEP = 1000 / 60
const MAX_STEPS_PER_FRAME = 4

export const useDeveloperOrbs = (options: {
  getMagnet: () => DeveloperMagnet | null
  /** 名片的静态碰撞箱（视口坐标的矩形）；没开名片就返回 null */
  getCardRect?: () => { x: number; y: number; width: number; height: number } | null
}) => {
  const views = shallowRef<DeveloperOrbView[]>([])
  /** 磁力是否开着（关掉后小球只受重力，往外掉） */
  const attracted = ref(false)
  /** 名片打开时被钉住的那颗球；null = 没开名片 */
  const heldId = ref<number | null>(null)
  /** 正在被拖的那颗球；null = 没在拖 */
  const draggingId = ref<number | null>(null)
  /** 被钉住那颗球的位置，供名片定位（只在这一颗上做响应式，每帧成本可忽略） */
  const heldAnchor = ref<{ x: number; y: number; radius: number } | null>(null)

  /** 拖动状态：指针目标（客户区坐标，和小球的 x/y 同一套坐标系） */
  let dragTargetX = 0
  let dragTargetY = 0
  let dragMoved = 0
  let dragStartedAt = 0
  /** 指针自己的速度（每帧量，指数平滑）：松手时小球继承它 */
  let dragPointerVx = 0
  let dragPointerVy = 0
  let dragLastX = 0
  let dragLastY = 0
  let dragLastAt = 0

  const orbs = new Map<number, OrbState>()
  const elements = new Map<number, HTMLElement>()
  const obstacles = new Map<HTMLElement, Obstacle>()
  const localWaves: LocalWave[] = []
  let unsubscribeWave: (() => void) | null = null
  let unsubscribeSweep: (() => void) | null = null
  let sequence = 0
  let frameHandle: number | null = null
  let previousTime = 0
  let accumulator = 0

  /** 大小相关的兜底：配置里少写/写错一个数也不该让球变成 NaN（宽高 NaN = 直接看不见） */
  const finiteOr = (value: number | undefined, fallback: number) => (
    Number.isFinite(value) ? Number(value) : fallback
  )

  /** 大小倍数：0–2 的浮点数（不取整），没写就用 defaultSizeScale */
  const clampScale = (value: number | undefined) => {
    const fallback = finiteOr(DeveloperConfig.defaultSizeScale, 1)
    const raw = Number.isFinite(value) ? Number(value) : fallback
    return Math.min(2, Math.max(0, raw))
  }

  /** 直径 = 基准大小 × 自己的倍数，再收在上下限里 */
  const diameterOf = (scale: number) => {
    const base = finiteOr(DeveloperConfig.size, 66)
    const minimum = finiteOr(DeveloperConfig.minimumDiameter, 26)
    const maximum = Math.max(minimum, finiteOr(DeveloperConfig.maximumDiameter, 160))
    const raw = base * scale
    return Math.min(maximum, Math.max(minimum, raw))
  }

  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight })

  const makeView = (orb: DeveloperOrb, scale: number): DeveloperOrbView => ({
    id: (sequence += 1),
    name: orb.name,
    info: orb.info,
    url: orb.url,
    avatar: orb.avatar,
    diameter: diameterOf(scale),
    sizeScale: scale,
    crown: orb.crown === true,
    crownInfo: typeof orb.crownInfo === 'string' ? orb.crownInfo : '',
  })

  /** 生成一批：每个开发者一颗，从屏幕外下方升起（x 在友链球左右随机撒开） */
  const begin = () => {
    if (!DeveloperConfig.enable) return
    release()
    const magnet = options.getMagnet()
    const { width, height } = viewport()
    const spawn = DeveloperConfig.spawn
    const listed = DeveloperConfig.orbs
    const centerX = magnet ? magnet.x : width * 0.75
    // 以友链球为中线左右撒开，但不超出视口
    const spread = Math.min(spawn.spreadX, spreadOf(centerX))

    views.value = []
    orbs.clear()
    elements.clear()

    listed.forEach((orb, index) => {
      const scale = clampScale(orb.sizeScale)
      const view = makeView(orb, scale)
      const radius = view.diameter / 2
      const x = clampX(centerX + (Math.random() * 2 - 1) * spread, radius)
      const jitter = 1 + (Math.random() * 2 - 1) * spawn.delayJitter
      const base = listed.length > 1 ? index / (listed.length - 1) : 0
      const state: OrbState = {
        id: view.id,
        view,
        radius,
        area: Math.PI * radius * radius,
        x,
        y: height + spawn.startBelow + radius,
        vx: (Math.random() * 2 - 1) * spawn.sideSpeed,
        vy: -spawn.upSpeed,
        swirlSign: DeveloperConfig.physics.swirlAlternate && index % 2 === 1 ? -1 : 1,
        delay: base * spawn.delaySpread * jitter,
        entered: false,
        dying: 0,
        knockUntil: 0,
        alive: true,
        element: null,
      }
      orbs.set(state.id, state)
      views.value.push(view)
    })

    attracted.value = true
    listenWaves()
    start()
  }

  /** 友链球归位：断磁，小球自由落体掉出屏幕 */
  const release = () => {
    attracted.value = false
    heldId.value = null
    heldAnchor.value = null
  }

  const destroy = () => {
    stop()
    unsubscribeWave?.()
    unsubscribeWave = null
    unsubscribeSweep?.()
    unsubscribeSweep = null
    localWaves.length = 0
    obstacles.clear()
    orbs.clear()
    elements.clear()
    views.value = []
    heldId.value = null
    heldAnchor.value = null
    attracted.value = false
  }

  const register = (id: number, element: HTMLElement | null) => {
    if (element) {
      elements.set(id, element)
      const orb = orbs.get(id)
      // 元素刚挂上就先写一次位置，免得第一帧之前它停在 (0,0) 闪一下
      if (orb) {
        orb.element = element
        element.style.transform = `translate3d(${(orb.x - orb.radius).toFixed(2)}px, ${(orb.y - orb.radius).toFixed(2)}px, 0)`
      }
    } else {
      elements.delete(id)
      const orb = orbs.get(id)
      if (orb) orb.element = null
    }
  }

  const hold = (id: number | null) => {
    heldId.value = id
    if (id === null) {
      heldAnchor.value = null
      return
    }
    const orb = orbs.get(id)
    if (orb) heldAnchor.value = { x: orb.x, y: orb.y, radius: orb.radius }
  }

  /** 开始拖某一颗球（坐标 = 客户区坐标） */
  const beginDrag = (id: number, clientX: number, clientY: number) => {
    if (!DeveloperConfig.drag.enable) return
    if (!orbs.has(id)) return
    draggingId.value = id
    dragTargetX = clientX
    dragTargetY = clientY
    dragMoved = 0
    dragStartedAt = performance.now()
    dragLastX = clientX
    dragLastY = clientY
    dragLastAt = dragStartedAt
    dragPointerVx = 0
    dragPointerVy = 0
  }

  /**
   * 拖动中：更新指针目标 + 累计"移动了多少"（区分点一下和拖走），
   * 同时把**指针自己的速度**平滑出来（松手时小球直接继承它，才有"甩出去"的感觉）。
   */
  const moveDrag = (clientX: number, clientY: number) => {
    const orb = draggingId.value !== null ? orbs.get(draggingId.value) : null
    if (!orb) return
    const now = performance.now()
    const elapsed = Math.max(1, now - dragLastAt)
    // 换算成"每帧"量（引擎里速度都是 px/帧，1 帧 = 1000/60 ms）
    const frameVx = (clientX - dragLastX) / elapsed * FIXED_STEP
    const frameVy = (clientY - dragLastY) / elapsed * FIXED_STEP
    // 指数平滑：单帧抖动不至于把松手速度带偏
    const smoothing = DeveloperConfig.drag.velocitySmoothing
    dragPointerVx = dragPointerVx * smoothing + frameVx * (1 - smoothing)
    dragPointerVy = dragPointerVy * smoothing + frameVy * (1 - smoothing)
    dragLastX = clientX
    dragLastY = clientY
    dragLastAt = now
    dragMoved = Math.max(dragMoved, Math.hypot(clientX - orb.x, clientY - orb.y))
    dragTargetX = clientX
    dragTargetY = clientY
  }

  /**
   * 松手：**继承指针的速度**（而不是跟手拉力残留的那点速度）再乘衰减系数，然后交回重力/磁力/碰撞。
   * 返回 true 表示"这只是一次轻点"（组件据此弹名片）。
   */
  const endDrag = () => {
    const orb = draggingId.value !== null ? orbs.get(draggingId.value) : null
    const drag = DeveloperConfig.drag
    const wasClick = !!orb
      && dragMoved <= drag.clickMaxMove
      && performance.now() - dragStartedAt <= drag.clickMaxTime
    if (orb) {
      const drag = DeveloperConfig.drag
      // 两条候选：① 指针自己的速度（甩出去的"速度继承"）② 它跟手时攒下的速度。
      // 取更大的那条——甩得快就继承甩的速度，慢慢拖/停住时也不会比原来更差。
      const inheritedX = dragPointerVx * drag.releaseRetention
      const inheritedY = dragPointerVy * drag.releaseRetention
      const ownX = orb.vx * drag.releaseRetention
      const ownY = orb.vy * drag.releaseRetention
      const useInherited = Math.hypot(inheritedX, inheritedY) >= Math.hypot(ownX, ownY)
      let vx = useInherited ? inheritedX : ownX
      let vy = useInherited ? inheritedY : ownY
      const cap = drag.maxReleaseSpeed
      const speed = Math.hypot(vx, vy)
      if (speed > cap) {
        vx = vx / speed * cap
        vy = vy / speed * cap
      }
      orb.vx = vx
      orb.vy = vy
    }
    draggingId.value = null
    return wasClick
  }

  const spreadOf = (centerX: number) => Math.min(centerX, viewport().width - centerX) // 让撒点别超出视口

  const clampX = (x: number, radius: number) => {
    const margin = DeveloperConfig.bounds.sideMargin + radius
    return Math.min(viewport().width - margin, Math.max(margin, x))
  }

  const magnetNow = () => (attracted.value ? options.getMagnet() : null)

  /** 一颗球的每帧推进：重力 → 引力环 → 切向绕转 → 阻尼限速 → 积分 → 边界 → 销毁判定 */
  const stepOrb = (orb: OrbState) => {
    if (!orb.alive) return
    if (orb.delay > 0) {
      orb.delay -= FIXED_STEP
      return
    }
    if (orb.dying > 0) {
      orb.dying -= FIXED_STEP
      orb.y += 2.4
      if (orb.dying <= 0) orb.alive = false
      return
    }
    // 正在被拖：只跟手（不吸、不落、不撞墙），松手后再交回物理
    if (draggingId.value === orb.id) {
      const drag = DeveloperConfig.drag
      const dx = dragTargetX - orb.x
      const dy = dragTargetY - orb.y
      const distance = Math.hypot(dx, dy)
      const pullRate = drag.pull
        + Math.min(drag.pullBonus, distance / drag.pullDistance * drag.pullBonus)
      orb.vx = (orb.vx + dx * pullRate) * drag.damping
      orb.vy = (orb.vy + dy * pullRate) * drag.damping
      orb.x += orb.vx
      orb.y += orb.vy
      return
    }
    // 被扫掠击飞的那一小段：纯直线飞出去（不吃重力/磁力/墙，允许穿模，也不限速）
    if (performance.now() < orb.knockUntil) {
      orb.x += orb.vx
      orb.y += orb.vy
      return
    }
    if (heldId.value === orb.id) {
      // 名片开着：把这颗球钉住（只做位置修正，不积分）
      orb.vx = 0
      orb.vy = 0
      return
    }

    const physics = DeveloperConfig.physics
    const { width, height } = viewport()
    orb.vy += physics.gravity

    const magnet = magnetNow()
    if (magnet) {
      const dx = magnet.x - orb.x
      const dy = magnet.y - orb.y
      const distance = Math.hypot(dx, dy) || 0.0001
      // 进到"死区"里就完全不再施力：只靠重力、惯性、碰撞自己处理，
      // 免得被吸到贴脸、贴着球抖（用户要求："进入链接一定范围内时取消引力影响"）
      if (distance < physics.range && distance > physics.attractInnerRadius) {
        const ring = magnet.radius + orb.radius + physics.ringGap
        const deviation = distance - ring
        const pull = Math.max(
          -physics.ringMaxPull,
          Math.min(physics.ringMaxPull, deviation * physics.ringStiffness),
        )
        const nx = dx / distance
        const ny = dy / distance
        orb.vx += nx * pull
        orb.vy += ny * pull
        // 切向：绕过友链球，而不是直挺挺撞上去
        const sign = orb.swirlSign
        orb.vx += -ny * physics.swirl * sign
        orb.vy += nx * physics.swirl * sign
      }
    }

    orb.vx *= physics.air
    orb.vy *= physics.air
    const speed = Math.hypot(orb.vx, orb.vy)
    if (speed > physics.maxSpeed) {
      orb.vx = orb.vx / speed * physics.maxSpeed
      orb.vy = orb.vy / speed * physics.maxSpeed
    }

    orb.x += orb.vx
    orb.y += orb.vy

    if (!orb.entered && orb.y - orb.radius < height) orb.entered = true

    const bounds = DeveloperConfig.bounds
    const left = bounds.sideMargin + orb.radius
    const right = width - bounds.sideMargin - orb.radius
    if (orb.x < left) {
      orb.x = left
      orb.vx = Math.abs(orb.vx) * bounds.bounce
    } else if (orb.x > right) {
      orb.x = right
      orb.vx = -Math.abs(orb.vx) * bounds.bounce
    }
    if (orb.y < bounds.topMargin + orb.radius) {
      orb.y = bounds.topMargin + orb.radius
      orb.vy = Math.abs(orb.vy) * bounds.bounce
    }

    // 友链球还在时，底边也是墙：被撞飞出去只会弹回来，不会"飞出窗口就被销毁"
    //（销毁只有一个合法时机：友链球归位、磁力断了之后往下掉）
    if (attracted.value && orb.y > height - bounds.bottomMargin - orb.radius) {
      orb.y = height - bounds.bottomMargin - orb.radius
      orb.vy = -Math.abs(orb.vy) * bounds.bounce
    }

    // 掉出屏幕下方：淡出后销毁（**只在已经断磁时判**）。
    // 还没进过画面的（生成时就在屏幕外、又被提前断磁的）要按"生成点再往下掉一段"判，
    // 否则刚生成就满足条件，或者反过来永远掉不到底、循环停不下来。
    const fallLimit = height + DeveloperConfig.despawn.below
      + (orb.entered ? 0 : DeveloperConfig.spawn.startBelow)
    if (!attracted.value && orb.y - orb.radius > fallLimit) {
      orb.dying = DeveloperConfig.despawn.fadeDuration
    }
  }

  /** 小球之间 + 小球与友链球圆影：迭代几次，位置修正 + 速度交换 */
  const resolveCollisions = () => {
    const list = [...orbs.values()].filter((orb) => orb.alive && orb.delay <= 0 && orb.dying <= 0)
    const collision = DeveloperConfig.collision
    const physics = DeveloperConfig.physics
    const now = performance.now()

    for (let iteration = 0; iteration < collision.iterations; iteration += 1) {
      for (let index = 0; index < list.length; index += 1) {
        const a = list[index]
        if (!a) continue
        for (let other = index + 1; other < list.length; other += 1) {
          const b = list[other]
          if (!b) continue
          // 被击飞中的小球之间也允许穿模
          if (now < a.knockUntil || now < b.knockUntil) continue
          const dx = b.x - a.x
          const dy = b.y - a.y
          const distance = Math.hypot(dx, dy) || 0.0001
          const minDistance = a.radius + b.radius
          if (distance >= minDistance) continue
          const nx = dx / distance
          const ny = dy / distance
          const overlap = minDistance - distance
          const aHeld = heldId.value === a.id
          const bHeld = heldId.value === b.id
          // 被钉住的那颗当静态（无限质量）
          const inverseA = aHeld ? 0 : 1 / a.area
          const inverseB = bHeld ? 0 : 1 / b.area
          const inverseSum = inverseA + inverseB
          if (inverseSum <= 0) continue
          const shareA = inverseA / inverseSum
          const shareB = inverseB / inverseSum
          a.x -= nx * overlap * collision.push * shareA
          a.y -= ny * overlap * collision.push * shareA
          b.x += nx * overlap * collision.push * shareB
          b.y += ny * overlap * collision.push * shareB
          const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
          if (relative > 0) continue
          const impulse = -(1 + collision.restitution) * relative / inverseSum
          a.vx -= impulse * inverseA * nx
          a.vy -= impulse * inverseA * ny
          b.vx += impulse * inverseB * nx
          b.vy += impulse * inverseB * ny
        }
      }
    }

    const magnet = magnetNow()
    if (!magnet) return
    list.forEach((orb) => {
      const dx = orb.x - magnet.x
      const dy = orb.y - magnet.y
      const distance = Math.hypot(dx, dy) || 0.0001
      const minDistance = magnet.radius + orb.radius * physics.magnetInset
      if (distance >= minDistance) return
      const nx = dx / distance
      const ny = dy / distance
      const overlap = minDistance - distance
      orb.x += nx * overlap
      orb.y += ny * overlap
      const relative = orb.vx * nx + orb.vy * ny
      if (relative < 0) {
        orb.vx -= (1 + physics.magnetBounce) * relative * nx
        orb.vy -= (1 + physics.magnetBounce) * relative * ny
      }
    })
  }

  /** 把物理结果写进 DOM（不进响应式，60fps 也不心疼） */
  const render = () => {
    orbs.forEach((orb) => {
      const element = orb.element ?? elements.get(orb.id)
      if (!element) return
      const offsetX = orb.x - orb.radius
      const offsetY = orb.y - orb.radius
      element.style.transform = `translate3d(${offsetX.toFixed(2)}px, ${offsetY.toFixed(2)}px, 0)`
      const fading = orb.dying > 0 || !orb.alive
      if (fading !== (element.dataset.fading === '1')) {
        element.dataset.fading = fading ? '1' : '0'
        element.classList.toggle('is-fading', fading)
      }
    })

    // 供名片定位：只在这一颗上更新响应式
    const held = heldId.value !== null ? orbs.get(heldId.value) : null
    if (held) heldAnchor.value = { x: held.x, y: held.y, radius: held.radius }

    let alive = false
    orbs.forEach((orb) => {
      if (orb.alive) alive = true
    })
    if (!alive) {
      views.value = []
      orbs.clear()
      elements.clear()
      stop()
    }
  }

  /** 订阅引擎波纹：冲击波（窄屏崩飞、落定波纹、点击波纹…）也要能打到小球 */
  const listenWaves = () => {
    if (unsubscribeWave || !DeveloperConfig.wave.enable) return
    unsubscribeWave = onSoftPhysicsWave((wave) => {
      localWaves.push({
        x: wave.x,
        y: wave.y,
        force: wave.force,
        radiusScale: wave.radiusScale,
        radialScale: wave.radialScale,
        startAt: performance.now(),
        touched: new Set<number>(),
      })
    })
    // 扫掠击飞（Donate 展开时那块楔形区）也要把小球算进去——它不在物理场里，只能靠广播
    unsubscribeSweep = onSoftPhysicsSweep((sweep) => {
      const now = performance.now()
      orbs.forEach((orb) => {
        if (!orb.alive || orb.delay > 0 || orb.dying > 0) return
        if (draggingId.value === orb.id) return
        if (!sweep.contains(orb.x, orb.y)) return
        const weight = sweep.influenceScale
        const side = (Math.random() * 2 - 1) * sweep.spread * sweep.speed
        orb.vx += (sweep.direction.x * sweep.speed - sweep.direction.y * side) * weight
        orb.vy += (sweep.direction.y * sweep.speed + sweep.direction.x * side) * weight
        // 免疫窗口内纯直线飞出去：不吃重力、不被磁铁拽、也不撞墙（允许穿模）
        orb.knockUntil = Math.max(orb.knockUntil, now + sweep.immunity)
      })
    })
  }

  /** 波前扩散：和引擎同一套公式与参数，只是小球没有 Z 轴，径向冲量按 radialBoost 放大 */
  const propagateWaves = () => {
    if (localWaves.length === 0) return
    const config = DeveloperConfig.wave
    const now = performance.now()
    for (let index = localWaves.length - 1; index >= 0; index -= 1) {
      const wave = localWaves[index]
      if (!wave) continue
      const elapsed = now - wave.startAt
      const frontRadius = elapsed * PhysicsConfig.wave.frontSpeed * wave.radiusScale
      const maximumRadius = PhysicsConfig.wave.maximumRadius * wave.radiusScale
      orbs.forEach((orb) => {
        if (!orb.alive || orb.delay > 0 || orb.dying > 0 || wave.touched.has(orb.id)) return
        const dx = orb.x - wave.x
        const dy = orb.y - wave.y
        const distance = Math.max(PhysicsConfig.wave.minimumDistance, Math.hypot(dx, dy))
        if (distance > maximumRadius || frontRadius < distance) return
        wave.touched.add(orb.id)
        const falloff = (1 - distance / maximumRadius) ** PhysicsConfig.wave.falloffExponent
        const amplitude = wave.force * falloff * config.influence / config.mass
        orb.vx += (dx / distance) * amplitude
          * PhysicsConfig.wave.radialImpulse * wave.radialScale * config.radialBoost
        orb.vy += (dy / distance) * amplitude
          * PhysicsConfig.wave.radialImpulse * wave.radialScale * config.radialBoost
      })
      if (
        elapsed > PhysicsConfig.wave.lifetime
        || frontRadius > maximumRadius + PhysicsConfig.wave.radiusTail
      ) localWaves.splice(index, 1)
    }
  }

  /** 这一帧这个物理组件算不算"墙"：看不见的（例如窄屏崩飞时被淡出的文字）不算 */
  const isVisibleObstacle = (element: HTMLElement) => {
    const check = (element as unknown as {
      checkVisibility?: (options?: Record<string, boolean>) => boolean
    }).checkVisibility
    if (typeof check !== 'function') return true
    return check.call(element, {
      opacityProperty: true,
      visibilityProperty: true,
      // 旧命名（部分 Chromium 版本）一并给上，多给不影响
      checkOpacity: true,
      checkVisibilityCSS: true,
    })
  }

  /** 收集场上其它物理组件，并算出它们这一帧的位移速度（用来判"扫过来"） */
  const gatherObstacles = () => {
    const config = DeveloperConfig.world
    if (!config.obstacles) {
      if (obstacles.size > 0) obstacles.clear()
      return
    }
    const seen = new Set<HTMLElement>()
    document.querySelectorAll<HTMLElement>('.soft-physics-item').forEach((element) => {
      if (config.ignoreSelector && element.matches(config.ignoreSelector)) return
      // 已经隐形的不当墙：窄屏打开 Donate 时文字被淡出但仍占着矩形，
      // 不排掉的话小球会被"看不见的字"挡在半路
      if (!isVisibleObstacle(element)) return
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      seen.add(element)
      const x = rect.left + rect.width / 2
      const y = rect.top + rect.height / 2
      const tracked = obstacles.get(element)
      if (tracked) {
        tracked.vx = x - tracked.x
        tracked.vy = y - tracked.y
        tracked.x = x
        tracked.y = y
        tracked.width = rect.width
        tracked.height = rect.height
      } else {
        obstacles.set(element, {
          element,
          width: rect.width,
          height: rect.height,
          x,
          y,
          vx: 0,
          vy: 0,
        })
      }
    })
    obstacles.forEach((_, element) => {
      if (!seen.has(element)) obstacles.delete(element)
    })
  }

  /**
   * 小球 ↔ 其它物理组件：**单向**——把它们当**墙体**。
   * 小球被推开、速度被反射；墙体自己的速度、碰撞状态、归位节奏一律不动
   * （唯一例外是"墙体正扫过来"：那是把墙体当移动的墙，把小球带走，仍然不碰墙体）。
   */
  const resolveObstacles = () => {
    if (obstacles.size === 0) return
    const config = DeveloperConfig.world
    const now = performance.now()
    orbs.forEach((orb) => {
      if (!orb.alive || orb.delay > 0 || orb.dying > 0) return
      // 正在被拖的那颗跟手优先；被击飞中的那颗允许穿模
      if (draggingId.value === orb.id || now < orb.knockUntil) return
      obstacles.forEach((obstacle) => {
        const halfWidth = obstacle.width / 2
        const halfHeight = obstacle.height / 2
        // 圆心到矩形最近点：这一步等价于"矩形 + 半径"的碰撞判定
        const closestX = Math.max(obstacle.x - halfWidth, Math.min(orb.x, obstacle.x + halfWidth))
        const closestY = Math.max(obstacle.y - halfHeight, Math.min(orb.y, obstacle.y + halfHeight))
        const dx = orb.x - closestX
        const dy = orb.y - closestY
        const distance = Math.hypot(dx, dy)
        const overlap = orb.radius + config.spacing - distance
        if (overlap <= 0) return

        const nx = distance > 0.0001 ? dx / distance : (orb.x < obstacle.x ? -1 : 1)
        const ny = distance > 0.0001 ? dy / distance : 0
        // ① 把小球推出去（墙不动）
        orb.x += nx * overlap
        orb.y += ny * overlap

        // ② 墙正扫过来（赞助面板飞出来 / 被拖动）：把小球一起带走，仍然不碰墙
        const sweep = Math.hypot(obstacle.vx, obstacle.vy)
        if (sweep > config.sweepSpeed) {
          orb.vx += obstacle.vx * config.sweepCarry
          orb.vy += obstacle.vy * config.sweepCarry
        }

        // ③ 小球撞墙：沿法线反射它自己的速度
        const relative = (orb.vx - obstacle.vx) * nx + (orb.vy - obstacle.vy) * ny
        if (relative >= 0) return
        orb.vx -= (1 + config.restitution) * relative * nx
        orb.vy -= (1 + config.restitution) * relative * ny
      })
    })
  }

  /** 名片是个**静态墙体**：别的小球撞上来被弹开，名片自己（和它那颗被钉住的小球）不动。 */
  /** 名片是个**静态墙体**：别的小球撞上来被弹开，名片自己（和它那颗被钉住的小球）不动。 */
  const resolveCard = () => {
    const card = options.getCardRect?.() ?? null
    if (!card || card.width <= 0 || card.height <= 0) return
    if (!DeveloperConfig.card.solidForOrbs) return
    const config = DeveloperConfig.world
    const right = card.x + card.width
    const bottom = card.y + card.height
    const centerX = card.x + card.width / 2
    const now = performance.now()
    orbs.forEach((orb) => {
      if (!orb.alive || orb.delay > 0 || orb.dying > 0) return
      // 被钉住的这颗就是名片的主人，别推自己；正在拖的 / 被击飞中的也放过
      if (heldId.value === orb.id || draggingId.value === orb.id || now < orb.knockUntil) return
      const closestX = Math.max(card.x, Math.min(orb.x, right))
      const closestY = Math.max(card.y, Math.min(orb.y, bottom))
      const dx = orb.x - closestX
      const dy = orb.y - closestY
      const distance = Math.hypot(dx, dy)
      const overlap = orb.radius + DeveloperConfig.card.solidSpacing - distance
      if (overlap <= 0) return
      const nx = distance > 0.0001 ? dx / distance : (orb.x < centerX ? -1 : 1)
      const ny = distance > 0.0001 ? dy / distance : 0
      orb.x += nx * overlap
      orb.y += ny * overlap
      const relative = orb.vx * nx + orb.vy * ny
      if (relative < 0) {
        orb.vx -= (1 + config.restitution) * relative * nx
        orb.vy -= (1 + config.restitution) * relative * ny
      }
    })
  }

  const step = () => {
    orbs.forEach(stepOrb)
    resolveCollisions()
    gatherObstacles()
    resolveObstacles()
    resolveCard()
    propagateWaves()
  }

  const frame = (now: number) => {
    frameHandle = window.requestAnimationFrame(frame)
    const raw = previousTime ? Math.min(now - previousTime, 200) : FIXED_STEP
    previousTime = now
    accumulator += raw
    let steps = 0
    while (accumulator >= FIXED_STEP && steps < MAX_STEPS_PER_FRAME) {
      step()
      accumulator -= FIXED_STEP
      steps += 1
    }
    if (accumulator > FIXED_STEP * MAX_STEPS_PER_FRAME) accumulator = 0
    render()
  }

  const start = () => {
    if (frameHandle !== null) return
    previousTime = 0
    accumulator = 0
    frameHandle = window.requestAnimationFrame(frame)
  }

  const stop = () => {
    if (frameHandle === null) return
    window.cancelAnimationFrame(frameHandle)
    frameHandle = null
  }

  return {
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
  }
}
