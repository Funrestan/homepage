<script setup lang="ts">
import { ref } from 'vue'
import { useSoftPhysics } from '../composables/useSoftPhysics'

const props = withDefaults(defineProps<{
  text?: string
  delay?: number
  mass?: number
  settleCollisionCooldown?: number
}>(), {
  text: '',
  delay: 0,
  mass: 0.82,
  settleCollisionCooldown: 520,
})

const visualElement = ref<HTMLElement | null>(null)
const {
  elementRef,
  dragging,
  dragVisualActive,
  pointerDown,
  pointerMove,
  pointerUp,
  clickCapture,
} = useSoftPhysics({
  mass: props.mass,
  influence: 1.08,
  cooldown: 760,
  settleCollisionCooldown: props.settleCollisionCooldown,
})

defineExpose({
  getElement: () => elementRef.value,
  getVisualElement: () => visualElement.value,
})
</script>

<template>
  <span
    ref="elementRef"
    class="soft-physics-item drag-word"
    :class="{ 'is-dragging': dragging, 'is-drag-active': dragVisualActive }"
    :style="{ '--float-delay': `${props.delay}s` }"
    :data-word="props.text || undefined"
    @pointerdown="pointerDown"
    @pointermove="pointerMove"
    @pointerup="pointerUp"
    @pointercancel="pointerUp"
    @lostpointercapture="pointerUp"
    @dragstart.prevent
    @click.capture="clickCapture"
  >
    <span class="drag-word__float">
      <span ref="visualElement" class="drag-word__visual">
        <slot>{{ text }}</slot>
      </span>
    </span>
  </span>
</template>

<style scoped>
.drag-word {
  position: relative;
  display: inline-block;
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}

.drag-word.is-dragging {
  z-index: 30;
  cursor: grabbing;
  transition: none;
}

.drag-word__float {
  display: inline-block;
}

.drag-word__visual {
  display: inline-block;
  will-change: transform, opacity, filter;
}

.is-dragging .drag-word__float {
  filter: brightness(1.08);
}

</style>
