<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import AnimationConfig from '../configs/animation.json'
import IdentityConfig from '../configs/identity.json'
import DragWord from './DragWord.vue'

type Phase = 'intro' | 'illuminate' | 'extract' | 'merge' | 'resolve' | 'done'

const props = withDefaults(defineProps<{
  name?: string
  startDelay?: number
}>(), {
  name: 'Funrestan',
  startDelay: AnimationConfig.entrance.compositionStart,
})

const emit = defineEmits<{
  complete: []
}>()

const phase = ref<Phase>('intro')
const showWorkbench = ref(true)
const identityRoot = ref<HTMLElement | null>(null)
const timers: number[] = []
const copyAnimations: Animation[] = []

type DragWordHandle = {
  getElement: () => HTMLElement | null
  getVisualElement: () => HTMLElement | null
}

type AssemblyPart = {
  id: string
  sourceId: string
  text: string
  floatDelay: number
}

type BioToken = {
  id: string
  text: string
  floatDelay: number
  extractId?: string
  tightLeft?: boolean
  kind?: 'name'
}

const assemblyParts = IdentityConfig.assembly.parts as AssemblyPart[]
const bioTokens = IdentityConfig.bioTokens as BioToken[]
const sourceHandles = new Map<string, DragWordHandle>()
const partHandles = new Map<string, DragWordHandle>()
const resolvedName = ref<DragWordHandle | null>(null)
const placedName = ref<DragWordHandle | null>(null)
const sentenceName = ref<DragWordHandle | null>(null)

const showResolvedName = computed(() => phase.value === 'resolve')
const showPlacedName = computed(() => phase.value === 'done')
const accessibleBio = computed(() => IdentityConfig.accessibleBio.replaceAll('{name}', props.name))
const identityStyle = computed(() => ({
  '--identity-source-transition': `${AnimationConfig.identity.sourceTransitionDuration}ms`,
  '--identity-workbench-transition': `${AnimationConfig.identity.workbenchTransitionDuration}ms`,
  '--identity-workbench-start-offset': `${AnimationConfig.identity.workbenchStartOffset}px`,
  '--identity-workbench-done-scale': String(AnimationConfig.identity.workbenchDoneScale),
  '--identity-parts-gap': `${AnimationConfig.identity.partsInitialGap}rem`,
  '--identity-parts-gap-duration': `${AnimationConfig.identity.partsGapDuration}ms`,
  '--identity-parts-fade-duration': `${AnimationConfig.identity.partsFadeDuration}ms`,
  '--identity-parts-filter-duration': `${AnimationConfig.identity.partsFilterDuration}ms`,
  '--identity-part-color-duration': `${AnimationConfig.identity.partColorDuration}ms`,
  '--identity-resolved-parts-blur': `${AnimationConfig.identity.resolvedPartsBlur}px`,
  '--identity-resolved-fade-duration': `${AnimationConfig.identity.resolvedEnterFadeDuration}ms`,
  '--identity-resolved-move-duration': `${AnimationConfig.identity.resolvedEnterMoveDuration}ms`,
  '--identity-resolved-enter-blur': `${AnimationConfig.identity.resolvedEnterBlur}px`,
  '--identity-resolved-enter-scale': String(AnimationConfig.identity.resolvedEnterScale),
}))
let completionEmitted = false

const setPartHandle = (id: string, instance: unknown) => {
  if (instance) partHandles.set(id, instance as DragWordHandle)
  else partHandles.delete(id)
}

const setBioHandle = (token: BioToken, instance: unknown) => {
  if (token.kind === 'name') {
    sentenceName.value = instance as DragWordHandle | null
    return
  }
  if (!token.extractId) return
  if (instance) sourceHandles.set(token.extractId, instance as DragWordHandle)
  else sourceHandles.delete(token.extractId)
}

const resolveBioText = (token: BioToken) => token.text.replaceAll('{name}', props.name)

const emitComplete = () => {
  if (completionEmitted) return
  completionEmitted = true
  emit('complete')
}

defineExpose({
  getElement: () => identityRoot.value,
})

const schedulePhase = (nextPhase: Phase, delay: number) => {
  timers.push(window.setTimeout(() => {
    phase.value = nextPhase
  }, delay))
}

const animateCopy = (source: DragWordHandle | null, target: DragWordHandle | null, delay: number) => {
  const sourceElement = source?.getElement()
  const targetElement = target?.getElement()
  const targetVisual = target?.getVisualElement()
  if (!sourceElement || !targetElement || !targetVisual) return

  const sourceRect = sourceElement.getBoundingClientRect()
  const targetRect = targetElement.getBoundingClientRect()
  const offsetX = sourceRect.left + sourceRect.width / 2 - targetRect.left - targetRect.width / 2
  const offsetY = sourceRect.top + sourceRect.height / 2 - targetRect.top - targetRect.height / 2

  const animation = targetVisual.animate([
    {
      transform: `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${AnimationConfig.identity.copyStartScale})`,
      opacity: AnimationConfig.identity.copyStartOpacity,
      filter: `blur(${AnimationConfig.identity.copyStartBlur}px)`,
    },
    {
      offset: AnimationConfig.identity.copyRevealOffset,
      opacity: 1,
      filter: 'blur(0)',
    },
    {
      transform: 'translate3d(0, 0, 0) scale(1)',
      opacity: 1,
      filter: 'blur(0)',
    },
  ], {
    duration: AnimationConfig.identity.copyDuration,
    delay,
    easing: AnimationConfig.identity.copyEasing,
    fill: 'backwards',
  })

  copyAnimations.push(animation)
}

const beginExtraction = async () => {
  phase.value = 'extract'
  await nextTick()
  assemblyParts.forEach((part, index) => {
    animateCopy(
      sourceHandles.get(part.sourceId) ?? null,
      partHandles.get(part.id) ?? null,
      AnimationConfig.identity.copyStagger * index,
    )
  })
}

const animatePlacement = (sourceRect: DOMRect, target: DragWordHandle | null, delay: number) => {
  const targetElement = target?.getElement()
  const targetVisual = target?.getVisualElement()
  if (!targetElement || !targetVisual) return

  const targetRect = targetElement.getBoundingClientRect()
  const offsetX = sourceRect.left + sourceRect.width / 2 - targetRect.left - targetRect.width / 2
  const offsetY = sourceRect.top + sourceRect.height / 2 - targetRect.top - targetRect.height / 2
  const sourceScale = sourceRect.height / Math.max(1, targetRect.height)

  const animation = targetVisual.animate([
    {
      transform: `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${sourceScale})`,
      opacity: 1,
    },
    {
      offset: AnimationConfig.identity.placementHoldOffset,
      opacity: 1,
    },
    {
      transform: 'translate3d(0, 0, 0) scale(1)',
      opacity: 1,
    },
  ], {
    duration: AnimationConfig.identity.placementDuration,
    delay,
    easing: AnimationConfig.identity.placementEasing,
    fill: 'backwards',
  })

  copyAnimations.push(animation)
}

const finishAnimation = async () => {
  const sourceRect = resolvedName.value?.getElement()?.getBoundingClientRect()
  phase.value = 'done'
  await nextTick()

  if (sourceRect) {
    animatePlacement(sourceRect, placedName.value, 0)
    animatePlacement(sourceRect, sentenceName.value, AnimationConfig.identity.placementStagger)
  }

  timers.push(window.setTimeout(() => {
    showWorkbench.value = false
    emitComplete()
  }, AnimationConfig.identity.completeAfterPlacement))
}

onMounted(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    phase.value = 'done'
    showWorkbench.value = false
    timers.push(window.setTimeout(emitComplete, 0))
    return
  }

  schedulePhase('illuminate', props.startDelay)
  const extractionStart = props.startDelay + AnimationConfig.identity.glowLead
  timers.push(window.setTimeout(beginExtraction, extractionStart))
  schedulePhase('merge', extractionStart + AnimationConfig.identity.mergeAfterExtraction)
  schedulePhase('resolve', extractionStart + AnimationConfig.identity.resolveAfterExtraction)
  timers.push(window.setTimeout(
    finishAnimation,
    extractionStart + AnimationConfig.identity.finishAfterExtraction,
  ))
})

onBeforeUnmount(() => {
  timers.forEach((timer) => window.clearTimeout(timer))
  copyAnimations.forEach((animation) => animation.cancel())
})
</script>

<template>
  <section ref="identityRoot" class="identity" :data-phase="phase" :style="identityStyle">
    <div class="identity__name" aria-live="polite">
      <DragWord
        v-if="showPlacedName"
        ref="placedName"
        :text="props.name"
        :delay="IdentityConfig.name.placedFloatDelay"
        class="identity__name-word"
      />
      <span v-if="!showPlacedName" class="identity__name-placeholder" aria-hidden="true">
        {{ props.name }}
      </span>

      <div v-if="showWorkbench" class="identity__workbench" aria-hidden="true">
        <div class="identity__assembly">
          <div class="identity__parts">
            <DragWord
              v-for="part in assemblyParts"
              :key="part.id"
              :ref="(instance) => setPartHandle(part.id, instance)"
              :text="part.text"
              :delay="part.floatDelay"
              class="identity__part"
              :data-assembly-part="part.id"
            />
          </div>
          <Transition name="resolved-name">
            <DragWord
              v-if="showResolvedName"
              ref="resolvedName"
              :text="props.name"
              :delay="IdentityConfig.name.resolvedFloatDelay"
              class="identity__resolved"
            />
          </Transition>
        </div>
      </div>
    </div>

    <p class="identity__accessible-copy">
      {{ accessibleBio }}
    </p>

    <div class="identity__sentence" aria-hidden="true">
      <template v-for="token in bioTokens" :key="token.id">
        <DragWord
          v-if="token.kind !== 'name' || showPlacedName"
          :ref="(instance) => setBioHandle(token, instance)"
          :text="resolveBioText(token)"
          :delay="token.floatDelay"
          :class="{
            'identity__source': token.extractId,
            'identity__punctuation': token.tightLeft,
            'identity__sentence-name': token.kind === 'name',
          }"
          :data-bio-token="token.id"
        />
      </template>
    </div>

  </section>
</template>

<style scoped>
.identity {
  --identity-ink: rgb(31 41 55);
  --identity-muted: rgb(75 85 99);
  --identity-glow: rgb(84 174 255);
  width: min(100%, 36rem);
  font-family: ui-rounded, "SF Pro Rounded", "Segoe UI Rounded", "Nunito", system-ui, sans-serif;
  color: var(--identity-ink);
  text-align: center;
  transition: color var(--theme-transition-duration) var(--theme-transition-easing);
}

.identity__name {
  position: relative;
  display: grid;
  min-height: 3rem;
  place-items: center;
  margin-bottom: 0.45rem;
  font-size: clamp(1.85rem, 4vw, 2.45rem);
  font-weight: 760;
  letter-spacing: -0.045em;
}

.identity__name-word,
.identity__name-placeholder {
  grid-area: 1 / 1;
}

.identity__name-word {
  color: var(--identity-ink);
  transition: color var(--theme-transition-duration) var(--theme-transition-easing);
}

.identity__name-placeholder {
  visibility: hidden;
}

.identity__sentence {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: center;
  column-gap: 0.32em;
  min-height: 3.4rem;
  color: var(--identity-muted);
  font-size: clamp(0.9rem, 1.5vw, 1.08rem);
  line-height: 1.85;
  text-wrap: balance;
  transition: color var(--theme-transition-duration) var(--theme-transition-easing);
}

.identity__punctuation {
  margin-left: -0.32em;
}

.identity__source {
  z-index: 1;
  color: var(--identity-ink);
  font-weight: 700;
  transition:
    color var(--identity-source-transition) ease,
    filter var(--identity-source-transition) ease,
    opacity var(--identity-source-transition) ease;
}

[data-phase="illuminate"] .identity__source,
[data-phase="extract"] .identity__source {
  color: rgb(15 111 190);
  filter: drop-shadow(0 0 7px rgb(68 171 255 / 42%));
}

[data-phase="resolve"] .identity__source {
  opacity: 0.52;
}

[data-phase="done"] .identity__source {
  color: inherit;
  font-weight: inherit;
  opacity: 1;
  filter: none;
}

.identity__workbench {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  overflow: visible;
  opacity: 0;
  transform: translateY(var(--identity-workbench-start-offset));
  transition:
    opacity var(--identity-workbench-transition) ease,
    transform var(--identity-workbench-transition) ease;
  pointer-events: none;
}

[data-phase="extract"] .identity__workbench,
[data-phase="merge"] .identity__workbench,
[data-phase="resolve"] .identity__workbench {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

[data-phase="done"] .identity__workbench {
  opacity: 0;
  transform: scale(var(--identity-workbench-done-scale));
  pointer-events: none;
}

.identity__assembly {
  position: relative;
  display: grid;
  place-items: center;
  min-width: 13rem;
  min-height: 2.5rem;
}

.identity__parts,
.identity__resolved {
  grid-area: 1 / 1;
}

.identity__parts {
  display: flex;
  align-items: baseline;
  gap: var(--identity-parts-gap);
  font-size: 1em;
  font-weight: 760;
  letter-spacing: -0.025em;
  transition:
    gap var(--identity-parts-gap-duration) cubic-bezier(0.22, 1, 0.36, 1),
    opacity var(--identity-parts-fade-duration) ease,
    filter var(--identity-parts-fade-duration) ease;
}

.identity__part {
  color: rgb(24 105 169);
  transition: color var(--identity-part-color-duration) ease;
}

.identity__part :deep(.drag-word__visual) {
  padding: 0.12rem 0 0.2rem;
  border: 0;
  background: transparent;
  box-shadow: none;
  transition:
    padding var(--identity-parts-gap-duration) cubic-bezier(0.22, 1, 0.36, 1),
    opacity var(--identity-parts-fade-duration) ease,
    filter var(--identity-parts-filter-duration) ease;
}

[data-phase="merge"] .identity__parts,
[data-phase="resolve"] .identity__parts {
  gap: 0;
}

[data-phase="merge"] .identity__part,
[data-phase="resolve"] .identity__part {
  color: rgb(20 78 124);
}

[data-phase="merge"] .identity__part :deep(.drag-word__visual),
[data-phase="resolve"] .identity__part :deep(.drag-word__visual) {
  padding-inline: 0;
}

[data-phase="resolve"] .identity__parts {
  opacity: 0;
  filter: blur(var(--identity-resolved-parts-blur));
}

.identity__resolved {
  color: rgb(17 92 151);
  font-size: 1em;
  font-weight: 780;
  letter-spacing: -0.04em;
  text-shadow: 0 0 18px rgb(74 173 255 / 38%);
}

.resolved-name-enter-active {
  transition:
    opacity var(--identity-resolved-fade-duration) ease,
    transform var(--identity-resolved-move-duration) cubic-bezier(0.18, 1.3, 0.32, 1),
    filter var(--identity-resolved-fade-duration) ease;
}

.resolved-name-enter-from {
  opacity: 0;
  filter: blur(var(--identity-resolved-enter-blur));
  transform: scale(var(--identity-resolved-enter-scale));
}

.identity__sentence-name {
  color: inherit;
  font-weight: inherit;
}

.identity__accessible-copy {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

:global(html.dark .identity) {
  --identity-ink: rgb(229 231 235);
  --identity-muted: rgb(209 213 219);
}

:global(html.dark [data-phase="illuminate"] .identity__source),
:global(html.dark [data-phase="extract"] .identity__source) {
  color: rgb(132 204 255);
}

:global(html.dark .identity__part .drag-word__visual) {
  background: transparent;
  box-shadow: none;
}

:global(html.dark .identity__part) {
  color: rgb(167 218 255);
}

:global(html.dark [data-phase="merge"] .identity__part),
:global(html.dark .identity__resolved) {
  color: rgb(156 215 255);
}

@media (max-height: 640px) {
  .identity__name {
    margin-bottom: 0.1rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .identity__workbench {
    display: none;
  }

  .identity__source,
  .identity__parts,
  .identity__part {
    transition: none;
  }

  .identity__part :deep(.drag-word__visual) {
    transition: none;
  }
}
</style>
