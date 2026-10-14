<script setup lang="ts">
import PhysicsConfig from '../configs/physics'
import { useSoftPhysics } from '../composables/useSoftPhysics'

const props = withDefaults(defineProps<{
  mass?: number
  influence?: number
  cooldown?: number
  settleCollisionCooldown?: number
  shape?: 'round' | 'compact' | 'soft'
  /** false = 拖动时不显示描边与高亮（大块区域用） */
  highlight?: boolean
  /** 命中这些后代（CSS 选择器）时不发起拖拽 */
  dragIgnoreSelector?: string
}>(), {
  mass: PhysicsConfig.presets.container.mass,
  influence: PhysicsConfig.presets.container.influence,
  cooldown: PhysicsConfig.presets.container.cooldown,
  settleCollisionCooldown: PhysicsConfig.presets.container.settleCollisionCooldown,
  shape: 'soft',
  highlight: true,
  dragIgnoreSelector: undefined,
})

const emit = defineEmits<{
  /** 双击（两次轻点）：触屏上比 DOM 的 dblclick 可靠 */
  doubleTap: []
}>()

const {
  elementRef,
  dragging,
  dragVisualActive,
  pointerDown,
  pointerUp,
  clickCapture,
} = useSoftPhysics({
  mass: props.mass,
  influence: props.influence,
  cooldown: props.cooldown,
  settleCollisionCooldown: props.settleCollisionCooldown,
  dragIgnoreSelector: props.dragIgnoreSelector,
  onDoubleTap: () => emit('doubleTap'),
})

defineExpose({
  getElement: () => elementRef.value,
})
</script>

<template>
  <span
    ref="elementRef"
    class="soft-physics-item physics-item"
    :class="[
      `physics-item--${props.shape}`,
      {
        'physics-item--plain': !props.highlight,
        'is-dragging': dragging,
        'is-drag-active': dragVisualActive,
      },
    ]"
    @pointerdown="pointerDown"
    @pointerup="pointerUp"
    @pointercancel="pointerUp"
    @dragstart.prevent
    @contextmenu.prevent
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
  /* 移动端：长按不要弹「存储图像 / 在新标签打开」这类系统菜单，
     否则浏览器会顺手发一个 pointercancel，拖拽就"断"了 */
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
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
