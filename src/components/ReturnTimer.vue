<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import UiConfig from '../configs/ui.json'
import {
  SOFT_PHYSICS_TIMER_COMPLETE_EVENT,
  SOFT_PHYSICS_TIMER_START_EVENT,
  triggerSoftPhysicsRipple,
} from '../composables/useSoftPhysics'

type TimerEvent = CustomEvent<{ timestamp: number }>
type TimerPhase = 'hidden' | 'running' | 'complete' | 'dismissing'

const timerRoot = ref<HTMLElement | null>(null)
const phase = ref<TimerPhase>('hidden')
const elapsed = ref(0)
let startedAt: number | null = null
let animationFrame: number | null = null
let displayTimer: number | null = null
let dismissTimer: number | null = null

const timerStyle = {
  '--return-timer-offset': UiConfig.returnTimer.offsetTop,
  '--return-timer-minimum-width': UiConfig.returnTimer.minimumWidth,
  '--return-timer-fade-duration': `${UiConfig.returnTimer.fadeDuration}ms`,
}

const formattedElapsed = computed(() => (elapsed.value / 1000).toFixed(UiConfig.returnTimer.precision))
const label = computed(() => phase.value === 'complete' || phase.value === 'dismissing'
  ? UiConfig.returnTimer.completeLabel
  : UiConfig.returnTimer.runningLabel)

const clearDismissTimers = () => {
  if (displayTimer !== null) window.clearTimeout(displayTimer)
  if (dismissTimer !== null) window.clearTimeout(dismissTimer)
  displayTimer = null
  dismissTimer = null
}

const stopAnimationFrame = () => {
  if (animationFrame !== null) window.cancelAnimationFrame(animationFrame)
  animationFrame = null
}

const updateElapsed = (time: number) => {
  if (phase.value !== 'running' || startedAt === null) {
    animationFrame = null
    return
  }
  elapsed.value = Math.max(0, time - startedAt)
  animationFrame = window.requestAnimationFrame(updateElapsed)
}

const handleStart = (event: Event) => {
  const timestamp = (event as TimerEvent).detail.timestamp
  clearDismissTimers()
  stopAnimationFrame()
  startedAt = timestamp
  elapsed.value = 0
  phase.value = 'running'
  animationFrame = window.requestAnimationFrame(updateElapsed)
}

const handleComplete = async (event: Event) => {
  if (startedAt === null) return
  const timestamp = (event as TimerEvent).detail.timestamp
  elapsed.value = Math.max(0, timestamp - startedAt)
  phase.value = 'complete'
  stopAnimationFrame()
  await nextTick()

  const rect = timerRoot.value?.getBoundingClientRect()
  if (rect) {
    triggerSoftPhysicsRipple(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      UiConfig.returnTimer.completionRippleSpeed,
    )
  }

  displayTimer = window.setTimeout(() => {
    phase.value = 'dismissing'
    dismissTimer = window.setTimeout(() => {
      phase.value = 'hidden'
      startedAt = null
    }, UiConfig.returnTimer.fadeDuration)
  }, UiConfig.returnTimer.displayDuration)
}

onMounted(() => {
  window.addEventListener(SOFT_PHYSICS_TIMER_START_EVENT, handleStart)
  window.addEventListener(SOFT_PHYSICS_TIMER_COMPLETE_EVENT, handleComplete)
})

onBeforeUnmount(() => {
  window.removeEventListener(SOFT_PHYSICS_TIMER_START_EVENT, handleStart)
  window.removeEventListener(SOFT_PHYSICS_TIMER_COMPLETE_EVENT, handleComplete)
  clearDismissTimers()
  stopAnimationFrame()
})
</script>

<template>
  <output
    v-if="phase !== 'hidden'"
    ref="timerRoot"
    class="return-timer is-visible"
    :class="{
      'is-complete': phase === 'complete',
      'is-dismissing': phase === 'dismissing',
    }"
    :style="timerStyle"
    aria-live="polite"
    aria-atomic="true"
  >
    <span>{{ label }}</span>
    <strong>{{ formattedElapsed }}</strong>
    <span>{{ UiConfig.returnTimer.unit }}</span>
  </output>
</template>

<style scoped>
.return-timer {
  position: absolute;
  top: var(--return-timer-offset);
  left: 50%;
  z-index: 4;
  display: inline-flex;
  min-width: var(--return-timer-minimum-width);
  align-items: baseline;
  justify-content: center;
  gap: 0.32rem;
  padding: 0.28rem 0.62rem;
  border: 1px solid rgb(125 181 219 / 28%);
  border-radius: 999px;
  color: rgb(55 65 81 / 82%);
  background: rgb(255 255 255 / 46%);
  box-shadow: 0 6px 20px rgb(26 96 143 / 10%);
  backdrop-filter: blur(9px);
  font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
  font-size: 0.68rem;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, 5px) scale(0.94);
  transition:
    opacity 180ms ease,
    transform 220ms cubic-bezier(0.18, 0.88, 0.24, 1),
    filter var(--return-timer-fade-duration) ease;
}

.return-timer strong {
  min-width: 5.8rem;
  color: rgb(17 92 151);
  font-size: 0.76rem;
  font-weight: 680;
  text-align: right;
}

.return-timer.is-visible {
  opacity: 1;
  transform: translate(-50%, 0) scale(1);
}

.return-timer.is-complete {
  border-color: rgb(102 194 255 / 42%);
  box-shadow: 0 8px 24px rgb(51 154 222 / 16%);
}

.return-timer.is-dismissing {
  opacity: 0;
  filter: blur(5px);
  transform: translate(-50%, -4px) scale(1.04);
  transition-duration: var(--return-timer-fade-duration);
}

:global(html.dark .return-timer) {
  color: rgb(209 213 219 / 82%);
  background: rgb(17 24 39 / 48%);
  border-color: rgb(125 211 252 / 24%);
}

:global(html.dark .return-timer strong) {
  color: rgb(147 213 255);
}
</style>
