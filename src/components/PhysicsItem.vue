<script setup lang="ts">
import PhysicsConfig from '../configs/physics.json'
import { useSoftPhysics } from '../composables/useSoftPhysics'

const props = withDefaults(defineProps<{
  mass?: number
  influence?: number
  cooldown?: number
  settleCollisionCooldown?: number
  shape?: 'round' | 'compact' | 'soft'
}>(), {
  mass: PhysicsConfig.presets.container.mass,
  influence: PhysicsConfig.presets.container.influence,
  cooldown: PhysicsConfig.presets.container.cooldown,
  settleCollisionCooldown: PhysicsConfig.presets.container.settleCollisionCooldown,
  shape: 'soft',
})

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
  influence: props.influence,
  cooldown: props.cooldown,
  settleCollisionCooldown: props.settleCollisionCooldown,
})

defineExpose({
  getElement: () => elementRef.value,
})
</script>

<template>
  <span
    ref="elementRef"
    class="soft-physics-item physics-item"
    :class="[`physics-item--${props.shape}`, { 'is-dragging': dragging, 'is-drag-active': dragVisualActive }]"
    @pointerdown="pointerDown"
    @pointermove="pointerMove"
    @pointerup="pointerUp"
    @pointercancel="pointerUp"
    @lostpointercapture="pointerUp"
    @dragstart.prevent
    @click.capture="clickCapture"
  >
    <span class="physics-item__content">
      <slot />
    </span>
  </span>
</template>

<style scoped>
.physics-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}

.physics-item.is-dragging {
  cursor: grabbing;
}

.physics-item__content {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: filter 240ms ease;
}

.physics-item--round .physics-item__content {
  border-radius: 999px;
}

.is-dragging .physics-item__content {
  filter: brightness(1.06) drop-shadow(0 9px 18px rgb(55 142 220 / 24%));
}
</style>
