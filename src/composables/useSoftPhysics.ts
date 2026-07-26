import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import PhysicsConfig from '../configs/physics.json'

type PhysicsOptions = {
  mass?: number
  influence?: number
  cooldown?: number
  settleCollisionCooldown?: number
}

type Particle = {
  id: number
  element: HTMLElement
  mass: number
  influence: number
  cooldown: number
  settleCollisionCooldown: number
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
  sourceId: number | null
  touched: Set<number>
}

const particles = new Map<number, Particle>()
const waves: PhysicsWave[] = []

let nextId = 1
let animationFrame: number | null = null
let previousFrame = 0
let lastRipple = 0
let globalPointerListenerActive = false

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
    const frontRadius = elapsed * PhysicsConfig.wave.frontSpeed
    const maximumRadius = PhysicsConfig.wave.maximumRadius

    for (const particle of items) {
      if (particle.id === wave.sourceId || wave.touched.has(particle.id)) continue

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

      particle.vz += amplitude * PhysicsConfig.wave.depthImpulse
      particle.vx += (dx / distance) * amplitude * PhysicsConfig.wave.radialImpulse
      particle.vy += (dy / distance) * amplitude * PhysicsConfig.wave.radialImpulse
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
            particle.collisionImmuneUntil = time + particle.settleCollisionCooldown
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
  animationFrame = window.requestAnimationFrame(tick)
}

const ensureEngine = () => {
  if (animationFrame === null) animationFrame = window.requestAnimationFrame(tick)
}

function createRipple(clientX: number, clientY: number, force = 1) {
  const now = performance.now()
  if (now - lastRipple < PhysicsConfig.wave.minimumInterval) return
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
  document.body.appendChild(ripple)
  window.setTimeout(() => ripple.remove(), PhysicsConfig.wave.elementLifetime)
}

function disturbField(
  source: Particle | null,
  clientX: number,
  clientY: number,
  speed: number,
  showRipple = true,
) {
  const strength = PhysicsConfig.wave.baseStrength + clamp(
    speed * PhysicsConfig.wave.speedStrength,
    0,
    PhysicsConfig.wave.maximumSpeedBonus,
  )

  waves.push({
    x: clientX,
    y: clientY,
    startedAt: performance.now(),
    force: strength,
    sourceId: source?.id ?? null,
    touched: new Set<number>(),
  })

  if (showRipple) {
    createRipple(
      clientX,
      clientY,
      PhysicsConfig.wave.visualBaseForce + speed * PhysicsConfig.wave.visualSpeedForce,
    )
  }
}

function handleGlobalPointerDown(event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  const target = event.target as HTMLElement | null
  if (target?.closest('.soft-physics-item')) return
  disturbField(null, event.clientX, event.clientY, PhysicsConfig.wave.idleClickSpeed)
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
      globalPointerListenerActive = true
    }
    paintParticle(particle)
    ensureEngine()
    window.addEventListener('pointerup', pointerUp, { passive: true })
    window.addEventListener('pointercancel', pointerUp, { passive: true })
  })

  onBeforeUnmount(() => {
    window.removeEventListener('pointerup', pointerUp)
    window.removeEventListener('pointercancel', pointerUp)
    if (!particle) return
    particles.delete(particle.id)
    particle = null
    if (particles.size === 0 && globalPointerListenerActive) {
      document.removeEventListener('pointerdown', handleGlobalPointerDown)
      globalPointerListenerActive = false
    }
  })

  const pointerDown = (event: PointerEvent) => {
    if (
      !particle
      || activePointer !== null
      || (event.pointerType === 'mouse' && event.button !== 0)
    ) return

    activePointer = event.pointerId
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
      if (!particle.element.hasPointerCapture(event.pointerId)) {
        particle.element.setPointerCapture(event.pointerId)
      }
    }
    if (moved) particle.returnRipplePending = true

    previousPointerX = event.clientX
    previousPointerY = event.clientY
    previousPointerTime = now
  }

  const pointerUp = (event: PointerEvent) => {
    if (!particle || activePointer !== event.pointerId) return

    const pointerId = activePointer
    activePointer = null
    if (particle.element.hasPointerCapture(pointerId)) {
      particle.element.releasePointerCapture(pointerId)
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
    pointerMove,
    pointerUp,
    clickCapture,
  }
}
