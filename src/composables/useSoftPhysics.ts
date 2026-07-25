import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

type PhysicsOptions = {
  mass?: number
  influence?: number
  cooldown?: number
}

type Particle = {
  id: number
  element: HTMLElement
  mass: number
  influence: number
  cooldown: number
  x: number
  y: number
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
  collisionImmuneUntil: number
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
  const squeeze = clamp(particle.compression, 0, 0.2)
  const depthScale = 1 + clamp(particle.z * 0.016, -0.045, 0.08)
  const horizontalImpact = speedX >= speedY
  const scaleX = (horizontalImpact ? 1 - squeeze : 1 + squeeze * 0.55) * depthScale
  const scaleY = (horizontalImpact ? 1 + squeeze * 0.55 : 1 - squeeze) * depthScale
  const rotation = clamp(particle.vx * 0.18, -4.5, 4.5)

  particle.element.style.setProperty('--physics-x', `${particle.x.toFixed(2)}px`)
  particle.element.style.setProperty('--physics-y', `${particle.y.toFixed(2)}px`)
  particle.element.style.setProperty('--physics-z', `${particle.z.toFixed(2)}px`)
  particle.element.style.setProperty('--physics-rotate', `${rotation.toFixed(2)}deg`)
  particle.element.style.setProperty('--physics-scale-x', scaleX.toFixed(4))
  particle.element.style.setProperty('--physics-scale-y', scaleY.toFixed(4))
  particle.element.style.setProperty('--physics-layer', particle.z > 0.8 ? '12' : 'auto')
}

const propagateWaves = (items: Particle[], time: number) => {
  for (let waveIndex = waves.length - 1; waveIndex >= 0; waveIndex -= 1) {
    const wave = waves[waveIndex]
    if (!wave) continue

    const elapsed = time - wave.startedAt
    const frontRadius = elapsed * 0.4
    const maximumRadius = 250

    for (const particle of items) {
      if (particle.id === wave.sourceId || wave.touched.has(particle.id)) continue

      const rect = particle.element.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      const dx = centerX - wave.x
      const dy = centerY - wave.y
      const distance = Math.max(10, Math.hypot(dx, dy))
      if (distance > maximumRadius || frontRadius < distance) continue

      wave.touched.add(particle.id)
      const falloff = (1 - distance / maximumRadius) ** 1.35
      const amplitude = wave.force * falloff * particle.influence / particle.mass

      particle.vz += amplitude * 0.46
      particle.vx += (dx / distance) * amplitude * 0.075
      particle.vy += (dy / distance) * amplitude * 0.075
      particle.compression = Math.max(particle.compression, clamp(amplitude * 0.014, 0, 0.08))
      particle.cooldownUntil = Math.max(particle.cooldownUntil, time + 230)
    }

    if (elapsed > 760 || frontRadius > maximumRadius + 45) waves.splice(waveIndex, 1)
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
      const overlapX = (current.width + other.width) / 2 + 2 - Math.abs(dx)
      const overlapY = (current.height + other.height) / 2 + 2 - Math.abs(dy)

      if (overlapX <= 0 || overlapY <= 0) continue

      const a = current.particle
      const b = other.particle
      if (time < a.collisionImmuneUntil || time < b.collisionImmuneUntil) continue

      const aReturning = !a.dragging && time >= a.cooldownUntil && Math.hypot(a.x, a.y) > 0.8
      const bReturning = !b.dragging && time >= b.cooldownUntil && Math.hypot(b.x, b.y) > 0.8
      if (aReturning || bReturning) continue

      const hasActiveMotion = a.dragging || b.dragging
        || Math.hypot(a.x, a.y) > 1
        || Math.hypot(b.x, b.y) > 1
        || Math.hypot(a.vx, a.vy) > 0.15
        || Math.hypot(b.vx, b.vy) > 0.15

      if (!hasActiveMotion) continue

      const aInverseMass = 1 / a.mass
      const bInverseMass = 1 / b.mass
      const totalInverseMass = aInverseMass + bInverseMass
      const aShare = aInverseMass / totalInverseMass
      const bShare = bInverseMass / totalInverseMass

      if (overlapX < overlapY) {
        const direction = dx >= 0 ? 1 : -1
        const push = Math.min(overlapX * 0.46, 8) * delta
        if (!a.dragging) {
          a.x -= direction * push * aShare
          a.vx -= direction * push * 0.18
        }
        if (!b.dragging) {
          b.x += direction * push * bShare
          b.vx += direction * push * 0.18
        }
      } else {
        const direction = dy >= 0 ? 1 : -1
        const push = Math.min(overlapY * 0.46, 8) * delta
        if (!a.dragging) {
          a.y -= direction * push * aShare
          a.vy -= direction * push * 0.18
        }
        if (!b.dragging) {
          b.y += direction * push * bShare
          b.vy += direction * push * 0.18
        }
      }

      const impact = clamp(Math.min(overlapX, overlapY) * 0.012, 0.025, 0.18)
      a.compression = Math.max(a.compression, impact)
      b.compression = Math.max(b.compression, impact)
    }
  }
}

const tick = (time: number) => {
  if (particles.size === 0) {
    animationFrame = null
    previousFrame = 0
    return
  }

  const delta = previousFrame ? clamp((time - previousFrame) / 16.67, 0.35, 2.2) : 1
  previousFrame = time
  const items = [...particles.values()]
  propagateWaves(items, time)

  for (const particle of items) {
    if (particle.dragging) {
      const targetDistance = Math.hypot(particle.dragTargetX - particle.x, particle.dragTargetY - particle.y)
      const increasingPull = 0.065 + clamp(targetDistance / 420, 0, 0.13)
      particle.vx += (particle.dragTargetX - particle.x) * increasingPull * delta
      particle.vy += (particle.dragTargetY - particle.y) * increasingPull * delta
      particle.vx *= 0.79 ** delta
      particle.vy *= 0.79 ** delta
      particle.x += particle.vx * delta
      particle.y += particle.vy * delta
      particle.compression = Math.max(particle.compression, clamp(targetDistance * 0.0014, 0.025, 0.16))
    } else {
      if (time >= particle.cooldownUntil) {
        const previousX = particle.x
        const previousY = particle.y
        const previousDistance = Math.hypot(previousX, previousY)
        const returnAge = Math.max(0, time - particle.cooldownUntil)
        const returnBoost = 1 + clamp(returnAge / 900, 0, 1.15)
        particle.vx += -particle.x * 0.07 * returnBoost * delta
        particle.vy += -particle.y * 0.07 * returnBoost * delta
        particle.vx *= 0.76 ** delta
        particle.vy *= 0.76 ** delta
        particle.x += particle.vx * delta
        particle.y += particle.vy * delta

        const distance = Math.hypot(particle.x, particle.y)
        const crossedHome = previousDistance > 0.7 && previousX * particle.x + previousY * particle.y <= 0
        if (distance < 1.15 || crossedHome) {
          const shouldRipple = particle.returnRipplePending
          particle.x = 0
          particle.y = 0
          particle.vx = 0
          particle.vy = 0
          particle.compression = Math.max(particle.compression, shouldRipple ? 0.14 : 0.055)
          particle.collisionImmuneUntil = time + 520
          particle.returnRipplePending = false

          if (shouldRipple) {
            particle.element.classList.remove('is-impacting')
            void particle.element.offsetWidth
            particle.element.classList.add('is-impacting')
            window.setTimeout(() => particle?.element.classList.remove('is-impacting'), 460)
            const rect = particle.element.getBoundingClientRect()
            disturbField(particle, rect.left + rect.width / 2, rect.top + rect.height / 2, 3)
          }
        }
      } else {
        particle.vx *= 0.965 ** delta
        particle.vy *= 0.965 ** delta
        particle.x += particle.vx * delta
        particle.y += particle.vy * delta
      }
    }

    particle.vz += -particle.z * 0.13 * delta
    particle.vz *= 0.78 ** delta
    particle.z += particle.vz * delta
    if (Math.abs(particle.z) < 0.015 && Math.abs(particle.vz) < 0.012) {
      particle.z = 0
      particle.vz = 0
    }

    particle.compression *= 0.86 ** delta
  }

  resolveCollisions(items, delta, time)

  items.forEach(paintParticle)
  animationFrame = window.requestAnimationFrame(tick)
}

const ensureEngine = () => {
  if (animationFrame === null) animationFrame = window.requestAnimationFrame(tick)
}

function createRipple(clientX: number, clientY: number, force = 1) {
  const now = performance.now()
  if (now - lastRipple < 90) return
  lastRipple = now

  const ripple = document.createElement('span')
  ripple.className = 'soft-physics-ripple'
  ripple.style.left = `${clientX}px`
  ripple.style.top = `${clientY}px`
  ripple.style.setProperty('--ripple-force', String(clamp(force, 0.7, 1.45)))
  document.body.appendChild(ripple)
  window.setTimeout(() => ripple.remove(), 820)
}

function disturbField(source: Particle | null, clientX: number, clientY: number, speed: number) {
  const strength = 2.2 + clamp(speed * 0.22, 0, 7)

  waves.push({
    x: clientX,
    y: clientY,
    startedAt: performance.now(),
    force: strength,
    sourceId: source?.id ?? null,
    touched: new Set<number>(),
  })

  createRipple(clientX, clientY, 0.82 + speed * 0.018)
}

function handleGlobalPointerDown(event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  const target = event.target as HTMLElement | null
  if (target?.closest('.soft-physics-item')) return
  disturbField(null, event.clientX, event.clientY, 2)
}

export const useSoftPhysics = (options: PhysicsOptions = {}) => {
  const elementRef: Ref<HTMLElement | null> = ref(null)
  const dragging = ref(false)

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
  let suppressClick = false

  onMounted(() => {
    if (!elementRef.value) return

    particle = {
      id: nextId,
      element: elementRef.value,
      mass: Math.max(0.35, options.mass ?? 1),
      influence: Math.max(0.2, options.influence ?? 1),
      cooldown: Math.max(0, options.cooldown ?? 720),
      x: 0,
      y: 0,
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
      collisionImmuneUntil: 0,
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
    if (!particle || (event.pointerType === 'mouse' && event.button !== 0)) return

    activePointer = event.pointerId
    pointerStartX = event.clientX
    pointerStartY = event.clientY
    particleStartX = particle.x
    particleStartY = particle.y
    previousPointerX = event.clientX
    previousPointerY = event.clientY
    previousPointerTime = performance.now()
    moved = false
    suppressClick = false
    particle.dragging = true
    particle.dragTargetX = particle.x
    particle.dragTargetY = particle.y
    particle.returnRipplePending = false
    particle.collisionImmuneUntil = 0
    particle.cooldownUntil = Number.POSITIVE_INFINITY
    dragging.value = true
    particle.compression = Math.max(particle.compression, 0.045)
    disturbField(particle, event.clientX, event.clientY, 2)
  }

  const pointerMove = (event: PointerEvent) => {
    if (!particle || activePointer !== event.pointerId) return

    const now = performance.now()
    const elapsed = Math.max(8, now - previousPointerTime)
    const nextX = particleStartX + event.clientX - pointerStartX
    const nextY = particleStartY + event.clientY - pointerStartY
    const pointerDeltaX = event.clientX - previousPointerX
    const pointerDeltaY = event.clientY - previousPointerY
    const speed = Math.hypot(pointerDeltaX, pointerDeltaY) * (16.67 / elapsed)

    particle.dragTargetX = nextX
    particle.dragTargetY = nextY
    const remainingX = nextX - particle.x
    const remainingY = nextY - particle.y
    const remainingDistance = Math.hypot(remainingX, remainingY)
    const dragImpulse = 0.012 + clamp(remainingDistance / 2200, 0, 0.045)
    particle.vx += remainingX * dragImpulse
    particle.vy += remainingY * dragImpulse
    particle.compression = Math.max(particle.compression, clamp(speed * 0.018, 0.03, 0.17))
    const crossedDragThreshold = Math.hypot(event.clientX - pointerStartX, event.clientY - pointerStartY) > 5
    if (!moved && crossedDragThreshold) {
      moved = true
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

    suppressClick = moved
    particle.returnRipplePending = moved
    particle.vx += (particle.dragTargetX - particle.x) * 0.04
    particle.vy += (particle.dragTargetY - particle.y) * 0.04
    particle.dragging = false
    particle.cooldownUntil = performance.now() + particle.cooldown
    particle.vx *= 0.62
    particle.vy *= 0.62
    dragging.value = false
  }

  const clickCapture = (event: MouseEvent) => {
    if (!suppressClick) return
    event.preventDefault()
    event.stopPropagation()
    suppressClick = false
  }

  return {
    elementRef,
    dragging,
    pointerDown,
    pointerMove,
    pointerUp,
    clickCapture,
  }
}
