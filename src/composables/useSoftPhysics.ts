import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import PhysicsConfig from '../configs/physics'

type PhysicsOptions = {
  mass?: number
  influence?: number
  cooldown?: number
  settleCollisionCooldown?: number
  /** 命中这些后代（CSS 选择器）时不发起拖拽，交给它们自己处理点击/输入。 */
  dragIgnoreSelector?: string
  /** 双击（两次轻点，位移没超过 doubleTapDistance）时回调；触屏上比 DOM 的 dblclick 可靠得多 */
  onDoubleTap?: () => void
}

type Particle = {
  id: number
  element: HTMLElement
  mass: number
  influence: number
  cooldown: number
  settleCollisionCooldown: number
  /** 本次归位落定时要用的碰撞冷却（一键归位时可以临时覆盖，落定后清空） */
  settleCooldownOverride: number | null
  x: number
  y: number
  paintedX: number
  paintedY: number
  vx: number
  vy: number
  z: number
  vz: number
  compression: number
  dragging: boolean
  cooldownUntil: number
  dragTargetX: number
  dragTargetY: number
  returnRipplePending: boolean
  returnRipplePrimed: boolean
  collisionReturnPending: boolean
  collisionImmuneUntil: number
  collisionActiveUntil: number
  dragVisualActive: Ref<boolean>
}

type PhysicsWave = {
  x: number
  y: number
  startedAt: number
  force: number
  radiusScale: number
  radialScale: number
  depthScale: number
  respectImmunity: boolean
  sourceId: number | null
  touched: Set<number>
}

export type SoftPhysicsRippleOptions = {
  /** 波纹影响半径的倍数，1 为默认范围（例如 2 = 范围大一倍）。 */
  radiusScale?: number
  /** 波纹力度的倍数，1 为默认力度。 */
  forceScale?: number
  /** 可见波纹扩散范围的倍数，缺省时跟随 radiusScale。 */
  visualRangeScale?: number
  /** 可见波纹寿命的倍数，缺省时跟随范围倍数的平方根。 */
  durationScale?: number
  /** 跳过波纹最小间隔限制，用于刻意释放的大波纹（例如 Donate 展开）。 */
  bypassInterval?: boolean
  /** 径向冲量倍数：崩飞这类需要"横向飞出去"的波纹把它调大。 */
  radialScale?: number
  /** 深度（Z 轴）冲量倍数：调小就不那么"朝观众方向弹"。 */
  depthScale?: number
  /** 是否尊重"落定免疫"：归位落定那圈波纹会带上它，避免把刚归位的邻居又推走。 */
  respectImmunity?: boolean
}

type ActivePointerHandler = {
  move: (event: PointerEvent) => void
  release: (event: PointerEvent) => void
}

const particles = new Map<number, Particle>()
const waves: PhysicsWave[] = []
const activePointerHandlers = new Map<number, ActivePointerHandler>()

/**
 * 波纹订阅：给"不在物理场里、但也该被冲击波推动"的自由物体用（例如友链的开发者小球）。
 * 引擎每次产生波纹时广播一次，订阅方自己去算波前扩散与衰减。
 */
export type SoftPhysicsWave = {
  x: number
  y: number
  force: number
  radiusScale: number
  radialScale: number
  depthScale: number
  startsAt: number
}

const waveListeners = new Set<(wave: SoftPhysicsWave) => void>()

export const onSoftPhysicsWave = (listener: (wave: SoftPhysicsWave) => void) => {
  waveListeners.add(listener)
  return () => { waveListeners.delete(listener) }
}

const broadcastWave = (wave: SoftPhysicsWave) => {
  waveListeners.forEach((listener) => listener(wave))
}

export const SOFT_PHYSICS_TIMER_START_EVENT = 'soft-physics:return-timer-start'
export const SOFT_PHYSICS_TIMER_COMPLETE_EVENT = 'soft-physics:return-timer-complete'

let nextId = 1
let animationFrame: number | null = null
let previousFrame = 0
let lastRipple = 0
let globalPointerListenerActive = false
let returnTimingActive = false
/** 自由场：为 true 时所有元素都不再归位（只留惯性），用于遮挡层弹开时把元素崩飞后留在原地。 */
let fieldFree = false

const dispatchReturnTimerEvent = (name: string, timestamp: number) => {
  window.dispatchEvent(new CustomEvent(name, { detail: { timestamp } }))
}

const beginReturnTiming = (timestamp = performance.now()) => {
  returnTimingActive = true
  dispatchReturnTimerEvent(SOFT_PHYSICS_TIMER_START_EVENT, timestamp)
}

const finishReturnTiming = (timestamp: number) => {
  if (!returnTimingActive) return
  returnTimingActive = false
  dispatchReturnTimerEvent(SOFT_PHYSICS_TIMER_COMPLETE_EVENT, timestamp)
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const paintParticle = (particle: Particle) => {
  const speedX = Math.abs(particle.vx)
  const speedY = Math.abs(particle.vy)
  const squeeze = clamp(particle.compression, 0, PhysicsConfig.paint.maximumCompression)
  const depthScale = 1 + clamp(
    particle.z * PhysicsConfig.paint.depthScaleFactor,
    PhysicsConfig.paint.minimumDepthScale,
    PhysicsConfig.paint.maximumDepthScale,
  )
  const horizontalImpact = speedX >= speedY
  const crossAxisExpansion = PhysicsConfig.paint.crossAxisExpansion
  const scaleX = (horizontalImpact ? 1 - squeeze : 1 + squeeze * crossAxisExpansion) * depthScale
  const scaleY = (horizontalImpact ? 1 + squeeze * crossAxisExpansion : 1 - squeeze) * depthScale
  const rotation = clamp(
    particle.vx * PhysicsConfig.paint.rotationVelocityFactor,
    -PhysicsConfig.paint.maximumRotation,
    PhysicsConfig.paint.maximumRotation,
  )

  particle.element.style.setProperty('--physics-x', `${particle.x.toFixed(2)}px`)
  particle.element.style.setProperty('--physics-y', `${particle.y.toFixed(2)}px`)
  particle.element.style.setProperty('--physics-z', `${particle.z.toFixed(2)}px`)
  particle.element.style.setProperty('--physics-rotate', `${rotation.toFixed(2)}deg`)
  particle.element.style.setProperty('--physics-scale-x', scaleX.toFixed(4))
  particle.element.style.setProperty('--physics-scale-y', scaleY.toFixed(4))
  particle.element.style.setProperty(
    '--physics-layer',
    particle.z > PhysicsConfig.paint.raisedDepth ? String(PhysicsConfig.paint.raisedLayer) : 'auto',
  )
  particle.paintedX = particle.x
  particle.paintedY = particle.y
}

const propagateWaves = (items: Particle[], time: number) => {
  for (let waveIndex = waves.length - 1; waveIndex >= 0; waveIndex -= 1) {
    const wave = waves[waveIndex]
    if (!wave) continue

    const elapsed = time - wave.startedAt
    const frontRadius = elapsed * PhysicsConfig.wave.frontSpeed * wave.radiusScale
    const maximumRadius = PhysicsConfig.wave.maximumRadius * wave.radiusScale

    for (const particle of items) {
      if (particle.id === wave.sourceId || wave.touched.has(particle.id)) continue
      // 落定免疫中的元素不再被波纹推动（归位落定那圈波纹默认如此，避免刚归位又被推走）
      if (wave.respectImmunity && time < particle.collisionImmuneUntil) continue

      const rect = particle.element.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      const dx = centerX - wave.x
      const dy = centerY - wave.y
      const distance = Math.max(PhysicsConfig.wave.minimumDistance, Math.hypot(dx, dy))
      if (distance > maximumRadius || frontRadius < distance) continue

      wave.touched.add(particle.id)
      const falloff = (1 - distance / maximumRadius) ** PhysicsConfig.wave.falloffExponent
      const amplitude = wave.force * falloff * particle.influence / particle.mass

      particle.vz += amplitude * PhysicsConfig.wave.depthImpulse * wave.depthScale
      particle.vx += (dx / distance) * amplitude * PhysicsConfig.wave.radialImpulse * wave.radialScale
      particle.vy += (dy / distance) * amplitude * PhysicsConfig.wave.radialImpulse * wave.radialScale
      particle.cooldownUntil = Math.max(
        particle.cooldownUntil,
        time + PhysicsConfig.wave.motionCooldown,
      )
    }

    if (
      elapsed > PhysicsConfig.wave.lifetime
      || frontRadius > maximumRadius + PhysicsConfig.wave.radiusTail
    ) waves.splice(waveIndex, 1)
  }
}

const resolveCollisions = (items: Particle[], delta: number, time: number) => {
  const measurements = items.map((particle) => {
    const rect = particle.element.getBoundingClientRect()
    return {
      particle,
      width: rect.width,
      height: rect.height,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
    }
  })

  for (let index = 0; index < measurements.length; index += 1) {
    const current = measurements[index]
    if (!current) continue

    for (let otherIndex = index + 1; otherIndex < measurements.length; otherIndex += 1) {
      const other = measurements[otherIndex]
      if (!other) continue

      const dx = other.centerX - current.centerX
      const dy = other.centerY - current.centerY
      const overlapX = (current.width + other.width) / 2 + PhysicsConfig.collision.spacing - Math.abs(dx)
      const overlapY = (current.height + other.height) / 2 + PhysicsConfig.collision.spacing - Math.abs(dy)

      if (overlapX <= 0 || overlapY <= 0) continue

      const a = current.particle
      const b = other.particle
      if (time < a.collisionImmuneUntil || time < b.collisionImmuneUntil) continue

      // Ripple motion is visual-only. Only a real drag/inertial impact may
      // start or continue the chain of label-to-label collisions.
      const aCollisionActive = a.dragVisualActive.value || time < a.collisionActiveUntil
      const bCollisionActive = b.dragVisualActive.value || time < b.collisionActiveUntil
      if (!aCollisionActive && !bCollisionActive) continue

      const aReturning = !a.dragging
        && time >= a.cooldownUntil
        && Math.hypot(a.x, a.y) > PhysicsConfig.collision.returningDistance
      const bReturning = !b.dragging
        && time >= b.cooldownUntil
        && Math.hypot(b.x, b.y) > PhysicsConfig.collision.returningDistance
      if (aReturning || bReturning) continue

      const hasActiveMotion = a.dragging || b.dragging
        || Math.hypot(a.x, a.y) > PhysicsConfig.collision.activeDistance
        || Math.hypot(b.x, b.y) > PhysicsConfig.collision.activeDistance
        || Math.hypot(a.vx, a.vy) > PhysicsConfig.collision.activeSpeed
        || Math.hypot(b.vx, b.vy) > PhysicsConfig.collision.activeSpeed

      if (!hasActiveMotion) continue

      const aInverseMass = 1 / a.mass
      const bInverseMass = 1 / b.mass
      const totalInverseMass = aInverseMass + bInverseMass
      const aShare = aInverseMass / totalInverseMass
      const bShare = bInverseMass / totalInverseMass
      let approachSpeed = 0

      if (overlapX < overlapY) {
        const direction = dx >= 0 ? 1 : -1
        const push = Math.min(
          overlapX * PhysicsConfig.collision.pushFactor,
          PhysicsConfig.collision.maximumPush,
        ) * delta
        const relativeVelocity = (b.vx - a.vx) * direction
        const bounce = relativeVelocity < 0
          ? -relativeVelocity * PhysicsConfig.collision.bounceFactor
          : 0
        approachSpeed = Math.max(0, -relativeVelocity)
        if (!a.dragging) {
          a.x -= direction * push * aShare
          a.vx -= direction * (push * PhysicsConfig.collision.velocityTransfer + bounce * aShare)
        }
        if (!b.dragging) {
          b.x += direction * push * bShare
          b.vx += direction * (push * PhysicsConfig.collision.velocityTransfer + bounce * bShare)
        }
      } else {
        const direction = dy >= 0 ? 1 : -1
        const push = Math.min(
          overlapY * PhysicsConfig.collision.pushFactor,
          PhysicsConfig.collision.maximumPush,
        ) * delta
        const relativeVelocity = (b.vy - a.vy) * direction
        const bounce = relativeVelocity < 0
          ? -relativeVelocity * PhysicsConfig.collision.bounceFactor
          : 0
        approachSpeed = Math.max(0, -relativeVelocity)
        if (!a.dragging) {
          a.y -= direction * push * aShare
          a.vy -= direction * (push * PhysicsConfig.collision.velocityTransfer + bounce * aShare)
        }
        if (!b.dragging) {
          b.y += direction * push * bShare
          b.vy += direction * (push * PhysicsConfig.collision.velocityTransfer + bounce * bShare)
        }
      }

      const impact = clamp(
        Math.min(overlapX, overlapY) * PhysicsConfig.collision.impactFactor,
        PhysicsConfig.collision.minimumImpact,
        PhysicsConfig.collision.maximumImpact,
      )
      const inertialDuration = clamp(
        PhysicsConfig.collision.baseInertia
          + approachSpeed * PhysicsConfig.collision.speedInertia
          + impact * PhysicsConfig.collision.impactInertia,
        PhysicsConfig.collision.minimumInertia,
        PhysicsConfig.collision.maximumInertia,
      )
      if (!a.dragging) {
        a.cooldownUntil = Math.max(a.cooldownUntil, time + inertialDuration)
        a.collisionActiveUntil = Math.max(a.collisionActiveUntil, time + inertialDuration)
        a.collisionReturnPending = true
      }
      if (!b.dragging) {
        b.cooldownUntil = Math.max(b.cooldownUntil, time + inertialDuration)
        b.collisionActiveUntil = Math.max(b.collisionActiveUntil, time + inertialDuration)
        b.collisionReturnPending = true
      }
      a.compression = Math.max(a.compression, impact)
      b.compression = Math.max(b.compression, impact)
    }
  }
}

const resolveViewportBounds = (items: Particle[], time: number) => {
  const margin = PhysicsConfig.bounds.margin
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight

  for (const particle of items) {
    const rect = particle.element.getBoundingClientRect()
    let correctionX = 0
    let correctionY = 0
    let horizontalDirection = 0
    let verticalDirection = 0

    if (rect.left < margin) {
      correctionX = margin - rect.left
      horizontalDirection = 1
    } else if (rect.right > viewportWidth - margin) {
      correctionX = viewportWidth - margin - rect.right
      horizontalDirection = -1
    }

    if (rect.top < margin) {
      correctionY = margin - rect.top
      verticalDirection = 1
    } else if (rect.bottom > viewportHeight - margin) {
      correctionY = viewportHeight - margin - rect.bottom
      verticalDirection = -1
    }

    if (correctionX !== 0) {
      particle.x += correctionX
      if (particle.dragging) {
        particle.vx = 0
        particle.dragTargetX = particle.x
      } else if (time < particle.cooldownUntil) {
        particle.vx = horizontalDirection * Math.abs(particle.vx) * PhysicsConfig.bounds.restitution
      }
      particle.compression = Math.max(particle.compression, PhysicsConfig.bounds.compression)
    }

    if (correctionY !== 0) {
      particle.y += correctionY
      if (particle.dragging) {
        particle.vy = 0
        particle.dragTargetY = particle.y
      } else if (time < particle.cooldownUntil) {
        particle.vy = verticalDirection * Math.abs(particle.vy) * PhysicsConfig.bounds.restitution
      }
      particle.compression = Math.max(particle.compression, PhysicsConfig.bounds.compression)
    }
  }
}

const getHomeCenter = (particle: Particle) => {
  const rect = particle.element.getBoundingClientRect()
  return {
    x: rect.left + rect.width / 2 - particle.paintedX,
    y: rect.top + rect.height / 2 - particle.paintedY,
  }
}

const primeReturnRipple = (particle: Particle) => {
  if (!particle.returnRipplePending || particle.returnRipplePrimed) return

  const velocitySquared = particle.vx ** 2 + particle.vy ** 2
  if (velocitySquared <= PhysicsConfig.return.primeVelocityEpsilon) return

  const framesToClosestApproach = -(particle.x * particle.vx + particle.y * particle.vy) / velocitySquared
  if (
    framesToClosestApproach <= 0
    || framesToClosestApproach
      > PhysicsConfig.return.primeLookahead / PhysicsConfig.frame.nominalDuration
  ) return

  const predictedDistance = Math.hypot(
    particle.x + particle.vx * framesToClosestApproach,
    particle.y + particle.vy * framesToClosestApproach,
  )
  if (predictedDistance >= PhysicsConfig.return.settleDistance) return

  const homeCenter = getHomeCenter(particle)
  createRipple(
    homeCenter.x,
    homeCenter.y,
    PhysicsConfig.wave.visualBaseForce
      + PhysicsConfig.wave.returnSpeed * PhysicsConfig.wave.visualSpeedForce,
  )
  particle.returnRipplePrimed = true
}

const tick = (time: number) => {
  if (particles.size === 0) {
    animationFrame = null
    previousFrame = 0
    return
  }

  const delta = previousFrame
    ? clamp(
      (time - previousFrame) / PhysicsConfig.frame.nominalDuration,
      PhysicsConfig.frame.minimumDelta,
      PhysicsConfig.frame.maximumDelta,
    )
    : 1
  previousFrame = time
  const items = [...particles.values()]
  propagateWaves(items, time)

  for (const particle of items) {
    if (particle.dragging) {
      const targetDistance = Math.hypot(particle.dragTargetX - particle.x, particle.dragTargetY - particle.y)
      const increasingPull = PhysicsConfig.drag.basePull + clamp(
        targetDistance / PhysicsConfig.drag.distanceForMaximumPull,
        0,
        PhysicsConfig.drag.maximumPullBonus,
      )
      particle.vx += (particle.dragTargetX - particle.x) * increasingPull * delta
      particle.vy += (particle.dragTargetY - particle.y) * increasingPull * delta
      particle.vx *= PhysicsConfig.drag.damping ** delta
      particle.vy *= PhysicsConfig.drag.damping ** delta
      particle.x += particle.vx * delta
      particle.y += particle.vy * delta
      particle.compression = Math.max(
        particle.compression,
        clamp(
          targetDistance * PhysicsConfig.drag.compressionFactor,
          PhysicsConfig.drag.minimumCompression,
          PhysicsConfig.drag.maximumCompression,
        ),
      )
    } else if (fieldFree) {
      // 自由场：不回归原点，只保留惯性阻尼，元素就停在被撞飞的地方
      particle.vx *= PhysicsConfig.return.inertiaDamping ** delta
      particle.vy *= PhysicsConfig.return.inertiaDamping ** delta
      particle.x += particle.vx * delta
      particle.y += particle.vy * delta
    } else {
      if (time >= particle.cooldownUntil) {
        const previousX = particle.x
        const previousY = particle.y
        const previousDistance = Math.hypot(previousX, previousY)
        const previousSpeed = Math.hypot(particle.vx, particle.vy)

        if (
          previousDistance < PhysicsConfig.return.idleDistance
          && previousSpeed < PhysicsConfig.return.idleSpeed
        ) {
          particle.x = 0
          particle.y = 0
          particle.vx = 0
          particle.vy = 0
          particle.returnRipplePending = false
          particle.returnRipplePrimed = false
          particle.collisionReturnPending = false
          particle.collisionActiveUntil = 0
          particle.dragVisualActive.value = false
        } else {
          const returnAge = Math.max(0, time - particle.cooldownUntil)
          const returnBoost = 1 + clamp(
            returnAge / PhysicsConfig.return.boostDuration,
            0,
            PhysicsConfig.return.maximumBoost,
          )
          particle.vx += -particle.x * PhysicsConfig.return.spring * returnBoost * delta
          particle.vy += -particle.y * PhysicsConfig.return.spring * returnBoost * delta
          particle.vx *= PhysicsConfig.return.damping ** delta
          particle.vy *= PhysicsConfig.return.damping ** delta
          particle.x += particle.vx * delta
          particle.y += particle.vy * delta
          primeReturnRipple(particle)

          const distance = Math.hypot(particle.x, particle.y)
          const crossedHome = previousDistance > PhysicsConfig.return.crossingDistance
            && previousX * particle.x + previousY * particle.y <= 0
          if (distance < PhysicsConfig.return.settleDistance || crossedHome) {
            const shouldRipple = particle.returnRipplePending
            const rippleWasPrimed = particle.returnRipplePrimed
            const shouldLiftOnSettle = particle.collisionReturnPending && !shouldRipple
            const homeCenter = shouldRipple ? getHomeCenter(particle) : null
            particle.x = 0
            particle.y = 0
            particle.vx = 0
            particle.vy = 0
            if (shouldRipple) {
              particle.compression = Math.max(
                particle.compression,
                PhysicsConfig.return.impactCompression,
              )
            }
            particle.collisionImmuneUntil = time + (
              particle.settleCooldownOverride ?? particle.settleCollisionCooldown
            )
            particle.settleCooldownOverride = null
            particle.collisionActiveUntil = 0
            particle.returnRipplePending = false
            particle.returnRipplePrimed = false
            particle.collisionReturnPending = false
            particle.dragVisualActive.value = false

            if (shouldLiftOnSettle) {
              particle.vz += PhysicsConfig.return.collisionLift
              particle.compression = Math.max(
                particle.compression,
                PhysicsConfig.return.collisionLiftCompression,
              )
            }

            if (shouldRipple) {
              particle.element.classList.remove('is-impacting')
              void particle.element.offsetWidth
              particle.element.classList.add('is-impacting')
              window.setTimeout(
                () => particle?.element.classList.remove('is-impacting'),
                PhysicsConfig.return.impactClassDuration,
              )
              if (homeCenter) {
                disturbField(
                  particle,
                  homeCenter.x,
                  homeCenter.y,
                  PhysicsConfig.wave.returnSpeed,
                  !rippleWasPrimed,
                  { respectImmunity: true },
                )
              }
            }
          }
        }
      } else {
        particle.vx *= PhysicsConfig.return.inertiaDamping ** delta
        particle.vy *= PhysicsConfig.return.inertiaDamping ** delta
        particle.x += particle.vx * delta
        particle.y += particle.vy * delta
      }
    }

    particle.vz += -particle.z * PhysicsConfig.depth.spring * delta
    particle.vz *= PhysicsConfig.depth.damping ** delta
    particle.z += particle.vz * delta
    if (
      Math.abs(particle.z) < PhysicsConfig.depth.snapPosition
      && Math.abs(particle.vz) < PhysicsConfig.depth.snapVelocity
    ) {
      particle.z = 0
      particle.vz = 0
    }

    particle.compression *= PhysicsConfig.compression.damping ** delta
  }

  resolveCollisions(items, delta, time)
  resolveViewportBounds(items, time)

  items.forEach(paintParticle)

  if (returnTimingActive && waves.length === 0) {
    const allParticlesSettled = items.every((particle) => (
      !particle.dragging
      && Math.hypot(particle.x, particle.y) <= PhysicsConfig.return.idleDistance
      && Math.hypot(particle.vx, particle.vy) <= PhysicsConfig.return.idleSpeed
    ))
    if (allParticlesSettled) finishReturnTiming(time)
  }

  animationFrame = window.requestAnimationFrame(tick)
}

const ensureEngine = () => {
  if (animationFrame === null) animationFrame = window.requestAnimationFrame(tick)
}

const rippleDuration = () => {
  const parsed = Number.parseFloat(PhysicsConfig.visual.rippleDuration)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 780
}

function createRipple(
  clientX: number,
  clientY: number,
  force = 1,
  rangeScale = 1,
  durationScale = 1,
  bypassInterval = false,
) {
  const now = performance.now()
  if (!bypassInterval && now - lastRipple < PhysicsConfig.wave.minimumInterval) return
  lastRipple = now

  const ripple = document.createElement('span')
  ripple.className = 'soft-physics-ripple'
  ripple.style.left = `${clientX}px`
  ripple.style.top = `${clientY}px`
  ripple.style.setProperty('--ripple-force', String(clamp(
    force,
    PhysicsConfig.wave.visualMinimumForce,
    PhysicsConfig.wave.visualMaximumForce,
  )))
  ripple.style.setProperty('--ripple-range', String(Math.max(0.2, rangeScale)))
  const lifetime = rippleDuration() * Math.max(0.2, durationScale)
  ripple.style.setProperty('--physics-ripple-duration', `${lifetime.toFixed(0)}ms`)
  document.body.appendChild(ripple)
  window.setTimeout(
    () => ripple.remove(),
    Math.max(PhysicsConfig.wave.elementLifetime, lifetime + 60),
  )
}

function disturbField(
  source: Particle | null,
  clientX: number,
  clientY: number,
  speed: number,
  showRipple = true,
  options: SoftPhysicsRippleOptions = {},
) {
  const radiusScale = Math.max(0.2, options.radiusScale ?? 1)
  const forceScale = Math.max(0, options.forceScale ?? 1)
  const strength = (PhysicsConfig.wave.baseStrength + clamp(
    speed * PhysicsConfig.wave.speedStrength,
    0,
    PhysicsConfig.wave.maximumSpeedBonus,
  )) * forceScale

  waves.push({
    x: clientX,
    y: clientY,
    startedAt: performance.now(),
    force: strength,
    radiusScale,
    radialScale: Math.max(0, options.radialScale ?? 1),
    depthScale: Math.max(0, options.depthScale ?? 1),
    respectImmunity: options.respectImmunity ?? false,
    sourceId: source?.id ?? null,
    touched: new Set<number>(),
  })

  broadcastWave({
    x: clientX,
    y: clientY,
    force: strength,
    radiusScale,
    radialScale: Math.max(0, options.radialScale ?? 1),
    depthScale: Math.max(0, options.depthScale ?? 1),
    startsAt: performance.now(),
  })

  if (showRipple) {
    const visualRangeScale = Math.max(0.2, options.visualRangeScale ?? radiusScale)
    createRipple(
      clientX,
      clientY,
      (PhysicsConfig.wave.visualBaseForce + speed * PhysicsConfig.wave.visualSpeedForce) * forceScale,
      visualRangeScale,
      options.durationScale ?? Math.sqrt(visualRangeScale),
      options.bypassInterval ?? false,
    )
  }
}

export const triggerSoftPhysicsRipple = (
  clientX: number,
  clientY: number,
  speed = PhysicsConfig.wave.returnSpeed,
  options: SoftPhysicsRippleOptions = {},
) => {
  disturbField(null, clientX, clientY, speed, true, options)
}

const findParticleByElement = (element: HTMLElement | null | undefined) => {
  if (!element) return null
  for (const particle of particles.values()) {
    if (particle.element === element || particle.element.contains(element)) return particle
  }
  return null
}

/**
 * 由某个元素自己发出的波纹：该元素作为源会被排除在外，不会被自己震飞。
 * 用来做"遮挡层弹开把其它元素崩飞"。
 */
export const triggerSoftPhysicsSourceRipple = (
  sourceElement: HTMLElement | null | undefined,
  clientX: number,
  clientY: number,
  speed = PhysicsConfig.wave.returnSpeed,
  options: SoftPhysicsRippleOptions = {},
) => {
  disturbField(findParticleByElement(sourceElement), clientX, clientY, speed, true, options)
}

/** 自由场开关：开启后所有元素停止归位，只受惯性与波纹影响。 */
export const setSoftPhysicsFree = (free: boolean) => {
  fieldFree = free
}

export type SoftPhysicsSweepOptions = {
  /** 瞬间速度大小（每帧量）：调大就是"击飞" */
  speed: number
  /** 侧向散开比例：0 = 全部严格沿运动方向，1 = 侧向也能分到同样的速度（会散成扇形） */
  spread?: number
  /** 碰撞免疫时长（ms）：这段时间内元素之间不再互相碰撞 = 允许穿模 */
  immunity?: number
  /** 免疫结束后再飞多久才开始归位（ms）：让它先飞完那一段 */
  flightDuration?: number
  /** 力度按 influence/mass 折算时的总系数 */
  influenceScale?: number
  /**
   * 排除的选择器：命中的元素**不参与这次击飞**。
   * 默认排除 `.donate-panel-host`——终点矩形中心就是面板自己，
   * 按几何判定它当然落在楔形区里，但它是"扫过去的那个东西"，不能给自己加初速。
   */
  ignoreSelector?: string
}

/** 一次扫掠击飞的完整描述：不在物理场里的自由物体（例如友链的开发者小球）据此自己吃这一下 */
export type SoftPhysicsSweep = {
  from: { x: number; y: number }
  rect: { left: number; top: number; right: number; bottom: number }
  /** 运动方向（单位向量） */
  direction: { x: number; y: number }
  speed: number
  spread: number
  immunity: number
  flightDuration: number
  influenceScale: number
  ignoreSelector: string
  /** 楔形区判定：给外部物体自己测自己在不在里面 */
  contains: (x: number, y: number) => boolean
}

const sweepListeners = new Set<(sweep: SoftPhysicsSweep) => void>()

/** 订阅扫掠击飞（给不在物理场里的自由物体用） */
export const onSoftPhysicsSweep = (listener: (sweep: SoftPhysicsSweep) => void) => {
  sweepListeners.add(listener)
  return () => { sweepListeners.delete(listener) }
}

const pointInTriangle = (
  point: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
) => {
  const sign = (p1: typeof point, p2: typeof point, p3: typeof point) =>
    (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y)
  const d1 = sign(point, a, b)
  const d2 = sign(point, b, c)
  const d3 = sign(point, c, a)
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNegative && hasPositive)
}

/**
 * **扫掠击飞**：把"出发点 → 终点矩形四角"围出来的那块楔形区域里的元素，
 * 沿"出发点 → 终点矩形中心"的方向甩出去，并给它们一小段碰撞免疫（允许穿模）。
 *
 * 用来给"从中心弹开"这类**简化动画**补一个真实扫掠才有的击飞感：
 * 面板本体不是真的从起点扫过去的，光靠碰撞算不出该有的冲量。
 */
export const launchSoftPhysicsSweep = (
  from: { x: number; y: number },
  rect: { left: number; top: number; right: number; bottom: number },
  options: SoftPhysicsSweepOptions,
) => {
  const speed = Math.max(0, options.speed)
  if (speed <= 0) return 0
  const spread = Math.max(0, options.spread ?? 0)
  const immunity = Math.max(0, options.immunity ?? 0)
  const flightDuration = Math.max(0, options.flightDuration ?? 0)
  const influenceScale = Math.max(0, options.influenceScale ?? 1)
  const ignoreSelector = options.ignoreSelector ?? '.donate-panel-host'

  const centerX = (rect.left + rect.right) / 2
  const centerY = (rect.top + rect.bottom) / 2
  const dx = centerX - from.x
  const dy = centerY - from.y
  const length = Math.hypot(dx, dy)
  const ux = length > 0.001 ? dx / length : 1
  const uy = length > 0.001 ? dy / length : 0
  const perpX = -uy
  const perpY = ux

  const corners = [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ]
  const inSweep = (x: number, y: number) => {
    const point = { x, y }
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return true
    // 出发点可能在矩形内也可能在外：用"出发点到每条边"的三角形铺满整块楔形区
    for (let index = 0; index < corners.length; index += 1) {
      const a = corners[index]
      const b = corners[(index + 1) % corners.length]
      if (!a || !b) continue
      if (pointInTriangle(point, from, a, b)) return true
    }
    return false
  }

  const now = performance.now()
  let hit = 0
  for (const particle of particles.values()) {
    // 用户正拖着的不动它（跟手优先）
    if (particle.dragging) continue
    // 被排除的元素（默认是 Donate 面板自己）：只给"别人"加初速，扫过去那个东西不加
    if (ignoreSelector && particle.element.matches(ignoreSelector)) continue
    const particleRect = particle.element.getBoundingClientRect()
    const x = particleRect.left + particleRect.width / 2
    const y = particleRect.top + particleRect.height / 2
    if (!inSweep(x, y)) continue

    const weight = influenceScale * particle.influence / Math.max(0.2, particle.mass)
    const side = (Math.random() * 2 - 1) * spread * speed
    particle.vx += (ux * speed + perpX * side) * weight
    particle.vy += (uy * speed + perpY * side) * weight
    particle.cooldownUntil = Math.max(
      particle.cooldownUntil,
      now + immunity + flightDuration,
    )
    // 免疫窗口：这段时间不参与元素间碰撞（允许穿模），过去之后照常连锁
    particle.collisionImmuneUntil = Math.max(particle.collisionImmuneUntil, now + immunity)
    particle.collisionActiveUntil = Math.max(particle.collisionActiveUntil, now + immunity)
    // 顺手给一下冲击压缩，看着像"被拍了一下"
    particle.compression = Math.max(particle.compression, PhysicsConfig.collision.minimumImpact * 2)
    hit += 1
  }

  // 广播给"不在物理场里"的自由物体（开发者小球），让它们吃同一下
  if (sweepListeners.size > 0) {
    const sweep: SoftPhysicsSweep = {
      from: { x: from.x, y: from.y },
      rect: { ...rect },
      direction: { x: ux, y: uy },
      speed,
      spread,
      immunity,
      flightDuration,
      influenceScale,
      ignoreSelector,
      contains: inSweep,
    }
    sweepListeners.forEach((listener) => listener(sweep))
  }
  return hit
}

export type SoftPhysicsSettleOptions = {
  /** 归位弹簧增益的预热量（ms）：越大归位越急（≳ boostDuration × maximumBoost 时吃满增益） */
  returnBoost?: number
  /** 归位落定后的碰撞冷却时长（ms）：这段时间内元素之间不再互相碰撞、也不被波纹推动 */
  collisionCooldown?: number
  /** 落定时是否出波纹（对没被拖拽过、纯粹被崩飞/吹动的元素也出） */
  settleRipple?: boolean
  /** 归位瞬间清掉正在扩散的波纹，免得刚拉回又被推走 */
  clearWaves?: boolean
}

/**
 * 一键归位：不是直接改坐标，而是把全体（非拖拽中的）元素切进"归位模式"——
 * 放开归位冷却并预支弹簧增益，让它们各自被归位弹簧拉回原点（先动、再落定），
 * 落定时照常出波纹、做挤压、并按本次的碰撞冷却免疫一段时间。
 * 用于双击头像这种"快速归位全部元素"。
 */
export const settleSoftPhysics = (options: SoftPhysicsSettleOptions = {}) => {
  const time = performance.now()
  const boost = Math.max(0, options.returnBoost ?? PhysicsConfig.return.boostDuration)
  const cooldown = Math.max(
    0,
    options.collisionCooldown ?? PhysicsConfig.defaults.settleCollisionCooldown,
  )
  const ripple = options.settleRipple ?? true

  for (const particle of particles.values()) {
    if (particle.dragging) continue

    // 归位模式：把"已经归位了多久"预支出去，弹簧立刻以对应增益把元素拉回
    particle.cooldownUntil = time - boost
    // 落定时用这次指定的冷却（覆盖预设值），期间先免疫掉碰撞
    particle.settleCooldownOverride = cooldown
    particle.collisionImmuneUntil = Math.max(particle.collisionImmuneUntil, time + cooldown)
    particle.collisionActiveUntil = 0
    particle.dragVisualActive.value = false
    particle.returnRipplePending = ripple
    particle.returnRipplePrimed = false
    particle.collisionReturnPending = false
  }

  if (options.clearWaves ?? true) waves.length = 0
  ensureEngine()
}

function handleGlobalPointerDown(event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  if (returnTimingActive) beginReturnTiming(performance.now())
  const target = event.target as HTMLElement | null
  if (target?.closest('.soft-physics-item')) return
  disturbField(null, event.clientX, event.clientY, PhysicsConfig.wave.idleClickSpeed)
}

function handleGlobalPointerMove(event: PointerEvent) {
  activePointerHandlers.get(event.pointerId)?.move(event)
}

function handleGlobalPointerRelease(event: PointerEvent) {
  activePointerHandlers.get(event.pointerId)?.release(event)
}

/**
 * 物理条目上一律禁掉长按上下文菜单：手机上长按会弹「存储图像 / 在新标签页打开」，
 * 浏览器随后发 pointercancel，拖拽当场断掉。写在这里，组件忘了加 @contextmenu.prevent 也安全。
 */
function handleGlobalContextMenu(event: MouseEvent) {
  const target = event.target
  if (target instanceof Element && target.closest('.soft-physics-item')) event.preventDefault()
}

export const useSoftPhysics = (options: PhysicsOptions = {}) => {
  const elementRef: Ref<HTMLElement | null> = ref(null)
  const dragging = ref(false)
  const dragVisualActive = ref(false)

  let particle: Particle | null = null
  let activePointer: number | null = null
  let pointerStartX = 0
  let pointerStartY = 0
  let particleStartX = 0
  let particleStartY = 0
  let previousPointerX = 0
  let previousPointerY = 0
  let previousPointerTime = 0
  let moved = false
  let suppressClickUntil = 0
  // 双击判定：记上一次"没位移的轻点"的时间与落点
  let lastTapAt = 0
  let lastTapX = 0
  let lastTapY = 0

  onMounted(() => {
    if (!elementRef.value) return

    particle = {
      id: nextId,
      element: elementRef.value,
      mass: Math.max(
        PhysicsConfig.defaults.minimumMass,
        options.mass ?? PhysicsConfig.defaults.mass,
      ),
      influence: Math.max(
        PhysicsConfig.defaults.minimumInfluence,
        options.influence ?? PhysicsConfig.defaults.influence,
      ),
      cooldown: Math.max(0, options.cooldown ?? PhysicsConfig.defaults.cooldown),
      settleCollisionCooldown: Math.max(
        0,
        options.settleCollisionCooldown ?? PhysicsConfig.defaults.settleCollisionCooldown,
      ),
      settleCooldownOverride: null,
      x: 0,
      y: 0,
      paintedX: 0,
      paintedY: 0,
      vx: 0,
      vy: 0,
      z: 0,
      vz: 0,
      compression: 0,
      dragging: false,
      cooldownUntil: 0,
      dragTargetX: 0,
      dragTargetY: 0,
      returnRipplePending: false,
      returnRipplePrimed: false,
      collisionReturnPending: false,
      collisionImmuneUntil: 0,
      collisionActiveUntil: 0,
      dragVisualActive,
    }

    nextId += 1
    particles.set(particle.id, particle)
    if (!globalPointerListenerActive) {
      document.addEventListener('pointerdown', handleGlobalPointerDown, { passive: true })
      window.addEventListener('pointermove', handleGlobalPointerMove, { passive: true })
      window.addEventListener('pointerup', handleGlobalPointerRelease, { passive: true })
      window.addEventListener('pointercancel', handleGlobalPointerRelease, { passive: true })
      document.addEventListener('contextmenu', handleGlobalContextMenu)
      globalPointerListenerActive = true
    }
    // 触屏上很常见：拖到一半切后台 / 窗口失焦，pointerup 永远不来 —— 主动收尾
    window.addEventListener('blur', cancelActiveDrag)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    paintParticle(particle)
    ensureEngine()
  })

  onBeforeUnmount(() => {
    if (activePointer !== null) activePointerHandlers.delete(activePointer)
    window.removeEventListener('blur', cancelActiveDrag)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    if (!particle) return
    particles.delete(particle.id)
    particle = null
    if (particles.size === 0 && globalPointerListenerActive) {
      document.removeEventListener('pointerdown', handleGlobalPointerDown)
      window.removeEventListener('pointermove', handleGlobalPointerMove)
      window.removeEventListener('pointerup', handleGlobalPointerRelease)
      window.removeEventListener('pointercancel', handleGlobalPointerRelease)
      document.removeEventListener('contextmenu', handleGlobalContextMenu)
      activePointerHandlers.clear()
      globalPointerListenerActive = false
    }
  })

  const pointerDown = (event: PointerEvent) => {
    if (
      !particle
      || activePointer !== null
      || (event.pointerType === 'mouse' && event.button !== 0)
    ) return

    // 内部按钮 / 链接自己处理交互，不从它们身上发起拖拽
    if (options.dragIgnoreSelector) {
      const target = event.target
      if (target instanceof Element && target.closest(options.dragIgnoreSelector)) return
    }

    activePointer = event.pointerId
    activePointerHandlers.set(event.pointerId, {
      move: pointerMove,
      release: pointerUp,
    })
    pointerStartX = event.clientX
    pointerStartY = event.clientY
    particleStartX = particle.x
    particleStartY = particle.y
    previousPointerX = event.clientX
    previousPointerY = event.clientY
    previousPointerTime = performance.now()
    moved = false
    suppressClickUntil = 0
    particle.dragging = true
    particle.dragTargetX = particle.x
    particle.dragTargetY = particle.y
    particle.returnRipplePending = false
    particle.returnRipplePrimed = false
    particle.collisionReturnPending = false
    particle.collisionImmuneUntil = 0
    particle.collisionActiveUntil = 0
    particle.cooldownUntil = Number.POSITIVE_INFINITY
    dragging.value = true
    particle.compression = Math.max(
      particle.compression,
      PhysicsConfig.drag.initialCompression,
    )
    disturbField(
      particle,
      event.clientX,
      event.clientY,
      PhysicsConfig.wave.dragStartSpeed,
    )
  }

  const pointerMove = (event: PointerEvent) => {
    if (!particle || activePointer !== event.pointerId) return

    const now = performance.now()
    const elapsed = Math.max(PhysicsConfig.drag.pointerMinimumElapsed, now - previousPointerTime)
    const nextX = particleStartX + event.clientX - pointerStartX
    const nextY = particleStartY + event.clientY - pointerStartY
    const pointerDeltaX = event.clientX - previousPointerX
    const pointerDeltaY = event.clientY - previousPointerY
    const speed = Math.hypot(pointerDeltaX, pointerDeltaY)
      * (PhysicsConfig.frame.nominalDuration / elapsed)

    particle.dragTargetX = nextX
    particle.dragTargetY = nextY
    const remainingX = nextX - particle.x
    const remainingY = nextY - particle.y
    const remainingDistance = Math.hypot(remainingX, remainingY)
    const dragImpulse = PhysicsConfig.drag.impulseBase + clamp(
      remainingDistance / PhysicsConfig.drag.impulseDistance,
      0,
      PhysicsConfig.drag.maximumImpulseBonus,
    )
    particle.vx += remainingX * dragImpulse
    particle.vy += remainingY * dragImpulse
    particle.compression = Math.max(
      particle.compression,
      clamp(
        speed * PhysicsConfig.drag.speedCompressionFactor,
        PhysicsConfig.drag.speedCompressionMinimum,
        PhysicsConfig.drag.speedCompressionMaximum,
      ),
    )
    const movementThreshold = event.pointerType === 'touch'
      ? PhysicsConfig.drag.touchThreshold
      : PhysicsConfig.drag.mouseThreshold
    const crossedDragThreshold = Math.hypot(
      event.clientX - pointerStartX,
      event.clientY - pointerStartY,
    ) > movementThreshold
    if (!moved && crossedDragThreshold) {
      moved = true
      dragVisualActive.value = true
      particle.collisionActiveUntil = Number.POSITIVE_INFINITY
      // 触屏上指针可能已经失效，捕获失败不能中断这次拖拽（后面的 move 仍会从 window 冒泡上来）
      try {
        if (!particle.element.hasPointerCapture(event.pointerId)) {
          particle.element.setPointerCapture(event.pointerId)
        }
      } catch {
        // 捕获失败就退化成"不捕获"，拖拽照旧
      }
    }
    if (moved) particle.returnRipplePending = true

    previousPointerX = event.clientX
    previousPointerY = event.clientY
    previousPointerTime = now
  }

  /** 收尾一次拖拽（松手 / 指针被系统取消 / 失焦切后台都走这里） */
  const finishDrag = (pointerId: number) => {
    if (!particle || activePointer !== pointerId) return

    activePointer = null
    activePointerHandlers.delete(pointerId)
    try {
      if (particle.element.hasPointerCapture(pointerId)) {
        particle.element.releasePointerCapture(pointerId)
      }
    } catch {
      // 指针已经没了，忽略
    }

    suppressClickUntil = moved
      ? performance.now() + PhysicsConfig.drag.clickSuppressionDuration
      : 0
    particle.returnRipplePending = moved
    if (!moved) dragVisualActive.value = false
    particle.vx += (particle.dragTargetX - particle.x) * PhysicsConfig.drag.releasePull
    particle.vy += (particle.dragTargetY - particle.y) * PhysicsConfig.drag.releasePull
    particle.dragging = false
    particle.cooldownUntil = performance.now() + particle.cooldown
    particle.collisionActiveUntil = moved ? particle.cooldownUntil : 0
    particle.vx *= PhysicsConfig.drag.releaseVelocityRetention
    particle.vy *= PhysicsConfig.drag.releaseVelocityRetention
    dragging.value = false
    if (moved) beginReturnTiming(performance.now())

    // 双击识别放在指针层（触屏上的 click/dblclick 会被缩放手势或轻微位移吃掉），
    // 且必须放在 dragging 已清零之后——回调里要让"被点的这个元素"自己也进入归位模式。
    if (moved) {
      lastTapAt = 0
    } else {
      const now = performance.now()
      const isDoubleTap = now - lastTapAt <= PhysicsConfig.drag.doubleTapInterval
        && Math.hypot(pointerStartX - lastTapX, pointerStartY - lastTapY)
          <= PhysicsConfig.drag.doubleTapDistance
      if (isDoubleTap) {
        lastTapAt = 0
        options.onDoubleTap?.()
      } else {
        lastTapAt = now
        lastTapX = pointerStartX
        lastTapY = pointerStartY
      }
    }
  }

  const pointerUp = (event: PointerEvent) => {
    finishDrag(event.pointerId)
  }

  /** 失焦 / 切到后台：指针事件不会再送达，主动当作松手处理，免得拖拽卡在半路 */
  const cancelActiveDrag = () => {
    if (activePointer !== null) finishDrag(activePointer)
  }

  const handleVisibilityChange = () => {
    if (document.hidden) cancelActiveDrag()
  }

  const clickCapture = (event: MouseEvent) => {
    if (performance.now() > suppressClickUntil) return
    event.preventDefault()
    event.stopPropagation()
    suppressClickUntil = 0
  }

  return {
    elementRef,
    dragging,
    dragVisualActive,
    pointerDown,
    pointerUp,
    clickCapture,
  }
}
