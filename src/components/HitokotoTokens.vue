<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AnimationConfig from '../configs/animation.json'
import DragWord from './DragWord.vue'

type HitokotoToken = {
  id: string
  text: string
  spaceBefore: boolean
}

type DragWordHandle = {
  getElement: () => HTMLElement | null
  getVisualElement: () => HTMLElement | null
}

const props = withDefaults(defineProps<{
  text?: string
  source?: string
  version?: number
  active?: boolean
  originSelector?: string
}>(), {
  text: '',
  source: '',
  version: 0,
  active: false,
  originSelector: '.profile-avatar-shell',
})

const contentTokens = ref<HitokotoToken[]>([])
const sourceTokens = ref<HitokotoToken[]>([])
const tokensHidden = ref(true)
const tokenHandles = new Map<string, DragWordHandle>()
const activeAnimations: Animation[] = []
const overlayElements = new Set<HTMLElement>()
const timers: number[] = []
let renderedVersion = -1
let refreshStarted = false

const isEnglishLetter = (character: string) => /^[A-Za-z]$/.test(character)

const tokenize = (value: string, prefix: string) => {
  const tokens: HitokotoToken[] = []
  let englishRun = ''
  let pendingSpace = false

  const pushToken = (text: string) => {
    tokens.push({
      id: `${prefix}-${tokens.length}-${text}`,
      text,
      spaceBefore: pendingSpace,
    })
    pendingSpace = false
  }

  const flushEnglish = () => {
    if (!englishRun) return
    pushToken(englishRun)
    englishRun = ''
  }

  for (const character of Array.from(value)) {
    if (isEnglishLetter(character)) {
      englishRun += character
      continue
    }

    flushEnglish()
    if (/\s/u.test(character)) {
      pendingSpace = true
      continue
    }
    pushToken(character)
  }

  flushEnglish()
  return tokens
}

const setTokenHandle = (id: string, instance: unknown) => {
  if (instance) tokenHandles.set(id, instance as DragWordHandle)
  else tokenHandles.delete(id)
}

const getOrigin = () => {
  const origin = document.querySelector<HTMLElement>(props.originSelector)
  if (!origin) return null
  const rect = origin.getBoundingClientRect()
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  }
}

const orderedHandles = () => Array.from(tokenHandles.values())
  .map((handle) => ({
    element: handle.getElement(),
  }))
  .filter((entry): entry is { element: HTMLElement } => Boolean(entry.element))
  .sort((a, b) => {
    const aRect = a.element.getBoundingClientRect()
    const bRect = b.element.getBoundingClientRect()
    return Math.abs(aRect.top - bRect.top) > 4 ? aRect.top - bRect.top : aRect.left - bRect.left
  })

const createTextOverlay = (element: HTMLElement) => {
  const rect = element.getBoundingClientRect()
  const style = getComputedStyle(element)
  const overlay = document.createElement('span')
  overlay.className = 'hitokoto-text-overlay'
  overlay.textContent = (element.textContent || '').trim()
  Object.assign(overlay.style, {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'border-box',
    margin: '0',
    padding: '0',
    border: '0',
    background: 'transparent',
    color: style.color,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontStyle: style.fontStyle,
    fontWeight: style.fontWeight,
    letterSpacing: style.letterSpacing,
    lineHeight: style.lineHeight,
    textShadow: style.textShadow,
    whiteSpace: 'pre',
    pointerEvents: 'none',
    zIndex: '70',
    transformOrigin: 'center',
  })
  document.body.appendChild(overlay)
  overlayElements.add(overlay)
  return { overlay, rect }
}

const trackOverlayAnimation = (
  animation: Animation,
  overlay: HTMLElement,
  revealElement?: HTMLElement,
) => {
  activeAnimations.push(animation)
  const cleanup = () => {
    overlay.remove()
    overlayElements.delete(overlay)
    if (revealElement) revealElement.style.removeProperty('visibility')
    const animationIndex = activeAnimations.indexOf(animation)
    if (animationIndex >= 0) activeAnimations.splice(animationIndex, 1)
  }
  animation.finished.then(cleanup, cleanup)
}

const stopActiveAnimations = () => {
  activeAnimations.splice(0).forEach((animation) => animation.cancel())
  orderedHandles().forEach(({ element }) => element.style.removeProperty('visibility'))
}

const dealCurrentTokens = async () => {
  await nextTick()
  const origin = getOrigin()
  if (!origin) {
    tokensHidden.value = false
    return
  }

  const entries = orderedHandles()
  tokensHidden.value = false
  entries.forEach(({ element }, index) => {
    element.style.visibility = 'hidden'
    const { overlay, rect } = createTextOverlay(element)
    const offsetX = origin.x - rect.left - rect.width / 2
    const offsetY = origin.y - rect.top - rect.height / 2
    const direction = index % 2 === 0 ? -1 : 1
    const animation = overlay.animate([
      {
        opacity: 0.58,
        filter: 'blur(4px)',
        transform: `translate3d(${offsetX}px, ${offsetY}px, 0) rotate(${direction * 6}deg) scale(0.58)`,
      },
      { offset: 0.24, opacity: 1, filter: 'blur(0)' },
      {
        offset: 0.76,
        opacity: 1,
        filter: 'blur(0)',
        transform: `translate3d(${offsetX * 0.12}px, ${offsetY * 0.12 - 4}px, 0) rotate(${direction * -1.2}deg) scale(1.02)`,
      },
      { opacity: 1, filter: 'blur(0)', transform: 'translate3d(0, 0, 0) rotate(0) scale(1)' },
    ], {
      duration: AnimationConfig.hitokoto.dealDuration,
      delay: index * AnimationConfig.hitokoto.dealCadence,
      easing: 'cubic-bezier(0.17, 0.86, 0.2, 1)',
      fill: 'backwards',
    })
    trackOverlayAnimation(animation, overlay, element)
  })
}

const renderVersion = async () => {
  if (!props.active || !props.text || !props.source || props.version === renderedVersion) return
  renderedVersion = props.version
  contentTokens.value = tokenize(`「${props.text}」`, `content-${props.version}`)
  sourceTokens.value = tokenize(`—— ${props.source}`, `source-${props.version}`)
  tokenHandles.clear()
  tokensHidden.value = true
  refreshStarted = false
  await dealCurrentTokens()
}

const beginRefresh = () => {
  if (refreshStarted) return
  refreshStarted = true
  stopActiveAnimations()
  const origin = getOrigin()
  if (!origin) return

  const entries = orderedHandles()
  entries.forEach(({ element }, index) => {
    const { overlay, rect } = createTextOverlay(element)
    element.style.visibility = 'hidden'
    const offsetX = origin.x - rect.left - rect.width / 2
    const offsetY = origin.y - rect.top - rect.height / 2
    const direction = index % 2 === 0 ? -1 : 1
    const animation = overlay.animate([
      {
        opacity: 0.92,
        color: 'rgb(148 163 184)',
        filter: 'blur(0)',
        transform: 'translate3d(0, 0, 0) rotate(0) scale(1)',
      },
      {
        offset: 0.72,
        opacity: 0.72,
        color: 'rgb(148 163 184)',
        filter: 'blur(0.8px)',
        transform: `translate3d(${offsetX * 0.78}px, ${offsetY * 0.78 - 5}px, 0) rotate(${direction * 2}deg) scale(0.76)`,
      },
      {
        opacity: AnimationConfig.hitokoto.collectOpacity,
        color: 'rgb(148 163 184)',
        filter: 'blur(1.8px)',
        transform: `translate3d(${offsetX}px, ${offsetY}px, 0) rotate(${direction * 6}deg) scale(0.48)`,
      },
    ], {
      duration: AnimationConfig.hitokoto.collectDuration,
      delay: index * AnimationConfig.hitokoto.collectCadence,
      easing: 'cubic-bezier(0.4, 0, 0.7, 0.25)',
      fill: 'forwards',
    })
    trackOverlayAnimation(animation, overlay)
  })

  tokensHidden.value = true
}

const cancelRefresh = () => {
  refreshStarted = false
  stopActiveAnimations()
  tokensHidden.value = false
}

watch(
  () => [props.active, props.version, props.text, props.source] as const,
  ([active, version]) => {
    if (!active || version === renderedVersion) return
    const delay = renderedVersion < 0 ? 0 : AnimationConfig.hitokoto.refreshGap
    timers.push(window.setTimeout(() => void renderVersion(), delay))
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  timers.forEach((timer) => window.clearTimeout(timer))
  stopActiveAnimations()
  overlayElements.forEach((element) => element.remove())
  overlayElements.clear()
})

defineExpose({ beginRefresh, cancelRefresh })
</script>

<template>
  <div class="hitokoto-token-lines" :class="{ 'is-hidden': tokensHidden }">
    <div class="hitokoto-token-line hitokoto-token-line--content">
      <DragWord
        v-for="token in contentTokens"
        :key="token.id"
        :ref="(instance) => setTokenHandle(token.id, instance)"
        :text="token.text"
        :delay="-1"
        :mass="0.72"
        :settle-collision-cooldown="AnimationConfig.hitokoto.settleCollisionCooldown"
        class="hitokoto-token"
        :class="{ 'has-leading-space': token.spaceBefore }"
      />
    </div>
    <div class="hitokoto-token-line hitokoto-token-line--source">
      <DragWord
        v-for="token in sourceTokens"
        :key="token.id"
        :ref="(instance) => setTokenHandle(token.id, instance)"
        :text="token.text"
        :delay="-1.5"
        :mass="0.72"
        :settle-collision-cooldown="AnimationConfig.hitokoto.settleCollisionCooldown"
        class="hitokoto-token"
        :class="{ 'has-leading-space': token.spaceBefore }"
      />
    </div>
  </div>
</template>

<style scoped>
.hitokoto-token-lines {
  width: 100%;
  color: rgb(75 85 99);
  transition: opacity 120ms ease;
}

.hitokoto-token-lines.is-hidden {
  opacity: 0;
  pointer-events: none;
}

.hitokoto-token-line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  min-height: 1.2rem;
  font-size: 0.875rem;
  line-height: 1.25rem;
}

.hitokoto-token-line--content {
  justify-content: center;
}

.hitokoto-token-line--source {
  justify-content: flex-end;
}

.hitokoto-token :deep(.drag-word__visual) {
  white-space: pre;
}

.hitokoto-token.has-leading-space {
  margin-left: 0.32em;
}

@media (prefers-color-scheme: dark) {
  .hitokoto-token-lines {
    color: rgb(209 213 219);
  }
}
</style>
