<script setup lang="ts">
import SiteConfig from './configs/site.json';
import AuthorInfo from './configs/author.json';

import { Icon } from '@iconify/vue'
import AnimatedIdentity from './components/AnimatedIdentity.vue';
import BackgroundInfo from './components/BackgroundInfo.vue';
import HitokotoTokens from './components/HitokotoTokens.vue';
import PhysicsItem from './components/PhysicsItem.vue';
import AnimationConfig from './configs/animation.json';
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
// set background
var defaultBackground = `url(${SiteConfig['background-img']})`;
var darkBackground = `url(${SiteConfig['darkmode-background-img']})`;

const usingDarkBackground = ref(false);
const profilePanel = ref<HTMLElement | null>(null);
const profileLinks = ref<HTMLElement | null>(null);
const profileFooter = ref<HTMLElement | null>(null);
const hitokotoText = ref('');
const hitokotoFrom = ref('');
const hitokotoReady = ref(false);
const showHitokoto = ref(false);
const entranceComplete = ref(false);
const hitokotoVersion = ref(0);
const entranceAnimations: Animation[] = [];

type ElementHandle = {
  getElement: () => HTMLElement | null
}

type HitokotoHandle = {
  beginRefresh: () => void
  cancelRefresh: () => void
}

const avatarItem = ref<ElementHandle | null>(null);
const identityItem = ref<ElementHandle | null>(null);
const hitokotoItem = ref<HitokotoHandle | null>(null);
let refreshTimer: number | null = null;
let hitokotoRefreshing = false;
const setCurrentTheme = () => {
  const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  usingDarkBackground.value = isDarkMode && darkBackground.length > 5; // url() is 5 characters
}

const fetchHitokoto = async () => {
  try {
    const hitokotoUrl = SiteConfig.hitokoto?.url || 'https://international.v1.hitokoto.cn';
    const response = await fetch(hitokotoUrl);
    const data = await response.json() as { hitokoto?: string; from?: string };
    const content = data.hitokoto || '';
    const source = data.from || '';

    if (content.length > 0 && source.length > 0) {
      hitokotoText.value = content;
      hitokotoFrom.value = source;
      hitokotoVersion.value += 1;
      hitokotoReady.value = true;
      if (entranceComplete.value) showHitokoto.value = true;
      return true;
    }
  } catch {
    hitokotoReady.value = false;
  }
  return false;
}

const refreshHitokoto = () => {
  if (!entranceComplete.value || hitokotoRefreshing) return;
  hitokotoRefreshing = true;
  hitokotoItem.value?.beginRefresh();
  if (refreshTimer !== null) window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(async () => {
    const updated = await fetchHitokoto();
    if (!updated) hitokotoItem.value?.cancelRefresh();
    hitokotoRefreshing = false;
  }, AnimationConfig.hitokoto.refreshRequestDelay);
}

const revealHitokoto = () => {
  entranceComplete.value = true;
  if (hitokotoReady.value) showHitokoto.value = true;
}

const registerEntrance = (animation: Animation) => {
  entranceAnimations.push(animation);
}

const runEntranceAnimation = async () => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  await nextTick();

  const panel = profilePanel.value;
  const avatarRoot = avatarItem.value?.getElement();
  const avatarVisual = avatarRoot?.querySelector<HTMLElement>('.physics-item__content');
  const identity = identityItem.value?.getElement();
  const links = profileLinks.value;
  if (!panel || !avatarRoot || !avatarVisual || !identity || !links) return;

  const avatarRect = avatarRoot.getBoundingClientRect();
  const nameRect = identity.querySelector<HTMLElement>('.identity__name')?.getBoundingClientRect();
  if (!nameRect) return;

  const finalAvatarX = avatarRect.left + avatarRect.width / 2;
  const finalAvatarY = avatarRect.top + avatarRect.height / 2;
  const nameCenterX = nameRect.left + nameRect.width / 2;
  const nameCenterY = nameRect.top + nameRect.height / 2;
  const avatarOffsetX = nameCenterX - finalAvatarX;
  const avatarOffsetY = nameCenterY - finalAvatarY;
  const fullWidthPanel = window.matchMedia('(max-width: 767px)').matches;
  const bioTargets = Array.from(identity.querySelectorAll<HTMLElement>(
    '.identity__sentence .drag-word__float, .identity__sentence > .identity__punctuation',
  )).map((element) => ({ element, rect: element.getBoundingClientRect() }));
  const linkTargets = Array.from(
    links.querySelectorAll<HTMLElement>('.profile-link-body .physics-item__content'),
  ).map((element) => ({ element, rect: element.getBoundingClientRect() }));
  const dealTargets = [
    ...bioTargets.map((target) => ({ ...target, kind: 'bio' as const })),
    ...linkTargets.map((target) => ({ ...target, kind: 'link' as const })),
  ];
  const entrance = AnimationConfig.entrance;
  const avatarDelay = entrance.avatarDelay;
  const dealStart = entrance.dealStart;
  const dealCadence = entrance.dealCadence;
  const compositionStart = entrance.compositionStart;
  const avatarEnd = entrance.avatarEnd;
  const avatarDuration = avatarEnd - avatarDelay;
  const steppedTravel = entrance.steppedTravel;
  const avatarTransform = (progress: number, scale = 1) => {
    const remaining = 1 - progress;
    return `translate3d(${avatarOffsetX * remaining}px, ${avatarOffsetY * remaining}px, 0) scale(${scale})`;
  };
  const avatarOffsetAt = (absoluteTime: number) => (absoluteTime - avatarDelay) / avatarDuration;
  const avatarFrames: Keyframe[] = [
    {
      offset: 0,
      opacity: 0,
      filter: 'blur(20px)',
      transform: avatarTransform(0, 0.82),
      easing: 'cubic-bezier(0.2, 0.82, 0.22, 1)',
    },
    {
      offset: avatarOffsetAt(entrance.avatarFadeEnd),
      opacity: 1,
      filter: 'blur(0)',
      transform: avatarTransform(0),
      easing: 'linear',
    },
    {
      offset: avatarOffsetAt(dealStart - 12),
      opacity: 1,
      filter: 'blur(0)',
      transform: avatarTransform(0),
      easing: 'linear',
    },
  ];

  dealTargets.forEach((_, index) => {
    const previousProgress = index / Math.max(1, dealTargets.length) * steppedTravel;
    const nextProgress = (index + 1) / Math.max(1, dealTargets.length) * steppedTravel;
    const dealTime = dealStart + index * dealCadence;
    avatarFrames.push(
      {
        offset: avatarOffsetAt(dealTime),
        opacity: 1,
        filter: 'blur(0)',
        transform: avatarTransform(previousProgress, 1.014),
        easing: 'cubic-bezier(0.18, 0.86, 0.22, 1)',
      },
      {
        offset: avatarOffsetAt(dealTime + 34),
        opacity: 1,
        filter: 'blur(0)',
        transform: avatarTransform(nextProgress, 0.992),
        easing: 'ease-out',
      },
    );
  });

  avatarFrames.push(
    {
      offset: avatarOffsetAt(compositionStart),
      opacity: 1,
      filter: 'blur(0)',
      transform: avatarTransform(steppedTravel),
      easing: 'cubic-bezier(0.16, 0.88, 0.2, 1)',
    },
    { offset: 1, opacity: 1, filter: 'blur(0)', transform: avatarTransform(1) },
  );

  registerEntrance(panel.animate(fullWidthPanel ? [
    { opacity: 0, filter: 'blur(18px)', transform: 'scale(1.025)' },
    { opacity: 1, filter: 'blur(0)', transform: 'scale(1)' },
  ] : [
    { opacity: 0.18, filter: 'blur(16px)', transform: 'translate3d(-104%, 0, 0)' },
    { opacity: 1, filter: 'blur(0)', transform: 'translate3d(0, 0, 0)' },
  ], {
    duration: fullWidthPanel ? entrance.panelFullscreenDuration : entrance.panelDesktopDuration,
    easing: 'cubic-bezier(0.18, 0.82, 0.22, 1)',
    fill: 'backwards',
  }));

  registerEntrance(avatarVisual.animate(avatarFrames, {
    duration: avatarDuration,
    delay: avatarDelay,
    easing: 'linear',
    fill: 'backwards',
  }));

  dealTargets.forEach(({ element, rect, kind }, index) => {
    const travelProgress = index / Math.max(1, dealTargets.length - 1) * steppedTravel;
    const sourceX = nameCenterX + (finalAvatarX - nameCenterX) * travelProgress;
    const sourceY = nameCenterY + (finalAvatarY - nameCenterY) * travelProgress;
    const offsetX = sourceX - rect.left - rect.width / 2;
    const offsetY = sourceY - rect.top - rect.height / 2;
    const direction = index % 2 === 0 ? -1 : 1;
    registerEntrance(element.animate([
      {
        opacity: 0,
        filter: `blur(${kind === 'bio' ? 8 : 6}px)`,
        transform: `translate3d(${offsetX}px, ${offsetY}px, 0) rotate(${direction * 7}deg) scale(${kind === 'bio' ? 0.56 : 0.48})`,
      },
      {
        offset: 0.2,
        opacity: 1,
        filter: 'blur(0)',
      },
      {
        offset: 0.74,
        opacity: 1,
        filter: 'blur(0)',
        transform: `translate3d(${offsetX * 0.14}px, ${offsetY * 0.14 - 7}px, 0) rotate(${direction * -1.4}deg) scale(1.025)`,
      },
      { opacity: 1, filter: 'blur(0)', transform: 'translate3d(0, 0, 0) rotate(0) scale(1)' },
    ], {
      duration: entrance.dealDuration,
      delay: dealStart + index * dealCadence,
      easing: 'cubic-bezier(0.17, 0.86, 0.2, 1)',
      fill: 'backwards',
    }));
  });

  if (profileFooter.value) {
    registerEntrance(profileFooter.value.animate([
      { opacity: 0, filter: 'blur(7px)', transform: 'translateY(12px)' },
      { opacity: 1, filter: 'blur(0)', transform: 'translateY(0)' },
    ], {
      duration: 620,
      delay: dealStart + dealTargets.length * dealCadence - 180,
      easing: 'ease-out',
      fill: 'backwards',
    }));
  }
}

setCurrentTheme();
document.documentElement.style.setProperty('--default-background', defaultBackground);
document.documentElement.style.setProperty('--dark-background', darkBackground);

let colorSchemeQuery: MediaQueryList | null = null;
const handleColorSchemeChange = () => setCurrentTheme();

onMounted(() => {
  colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  colorSchemeQuery.addEventListener('change', handleColorSchemeChange);
  void fetchHitokoto();
  void runEntranceAnimation();
});

onBeforeUnmount(() => {
  if (colorSchemeQuery) colorSchemeQuery.removeEventListener('change', handleColorSchemeChange);
  if (refreshTimer !== null) window.clearTimeout(refreshTimer);
  entranceAnimations.forEach((animation) => animation.cancel());
});
</script>

<template>
  <div class="flex h-screen w-screen">
    <div ref="profilePanel" class="profile-panel md:w-5/16 w-full h-full
                bg-white/50 border-white/50
                dark:bg-black/60 dark:border-gray-700/50
                backdrop-blur-2xl border-r transition-all duration-300
                shadow-[10px_0px_30px_rgba(0,0,0,0.25)] p-10
                flex flex-col items-center justify-center">
      <PhysicsItem ref="avatarItem" :mass="2.7" :influence="0.72" :cooldown="1100" shape="round" class="profile-avatar-shell">
        <img :src="AuthorInfo.avatar" alt="avatar" draggable="false"
          class="profile-avatar h-40 w-40 rounded-full shadow-xl">
      </PhysicsItem>
      <AnimatedIdentity
        ref="identityItem"
        :name="AuthorInfo.name"
        :start-delay="AnimationConfig.entrance.compositionStart"
        @complete="revealHitokoto"
      />
      <!-- 一言 -->
      <div
        v-if="SiteConfig.hitokoto.enable"
        class="hitokoto-shell"
        :class="{ 'is-visible': showHitokoto }"
        @click="refreshHitokoto"
      >
        <HitokotoTokens
          ref="hitokotoItem"
          :text="hitokotoText"
          :source="hitokotoFrom"
          :version="hitokotoVersion"
          :active="showHitokoto"
        />
      </div>
      <div ref="profileLinks" class="profile-links flex text-2xl gap-2">
        <PhysicsItem
          v-for="value in AuthorInfo.links"
          :key="value.name"
          :mass="1.05"
          :influence="1.16"
          :cooldown="880"
          shape="compact"
          class="profile-link-body"
        >
          <a :href="value.url" target="_blank" rel="noopener noreferrer" draggable="false"
                class="profile-link text-gray-700 hover:text-gray-900
                      dark:text-gray-300 dark:hover:text-white
                      transition-all duration-300 group relative
                      flex-col flex items-center justify-center"
                :style="{
                  '--icon-default': value.defaultColor || undefined,
                  '--icon-hover': value.hoverColor || undefined,
                }">
              <Icon :icon="value.icon" class="icon-color" />
              <div class="h-full text-sm absolute pt-10 opacity-0 transition-all duration-200
                          hover:opacity-100">
                {{ value.name }}
              </div>
          </a>
        </PhysicsItem>
      </div>
      <!-- </div> -->
    </div>
    <footer ref="profileFooter" class="profile-footer absolute bottom-0 md:w-5/16 w-full mb-3
                flex flex-col items-center justify-center">
      <template v-for="value in SiteConfig.icp" v-if="SiteConfig.icp">
        <a :href="value.url" target="_blank" rel="noopener noreferrer"
          class="text-gray-700 hover:text-gray-900
              dark:text-gray-200 dark:hover:text-white
              text-sm transition-colors duration-300">{{ value.name }}</a>
      </template>
      <p class="text-sm text-gray-700 dark:text-gray-100" v-if="SiteConfig.right">&copy; {{ SiteConfig.right }}</p>
    </footer>
    <div v-if="SiteConfig.showBackgroundInfo" 
        class="invisible md:visible right-0 bottom-0 absolute">
        <BackgroundInfo :dark-mod="usingDarkBackground"/>
      </div>
  </div>
</template>

<style scoped>
.icon-color {
  color: var(--icon-default, currentColor);
  transition: color 200ms ease;
}

.group:hover .icon-color {
  color: var(--icon-hover, currentColor);
}

.profile-avatar-shell {
  flex: 0 0 auto;
  margin-bottom: 1rem;
  border-radius: 999px;
}

.hitokoto-shell {
  width: 100%;
  min-height: 0;
  max-height: 0;
  margin-top: 0;
  overflow: hidden;
  opacity: 0;
  visibility: hidden;
  filter: blur(8px);
  transform: translateY(-8px) scale(0.97);
  transform-origin: top center;
  pointer-events: none;
  transition:
    opacity 620ms ease,
    filter 620ms ease,
    transform 720ms cubic-bezier(0.18, 0.9, 0.24, 1),
    max-height 720ms cubic-bezier(0.18, 0.9, 0.24, 1),
    margin-top 720ms cubic-bezier(0.18, 0.9, 0.24, 1),
    visibility 0s linear 720ms;
}

.hitokoto-shell.is-visible {
  max-height: 6rem;
  margin-top: 0.1rem;
  overflow: visible;
  opacity: 1;
  visibility: visible;
  filter: blur(0);
  transform: translateY(0) scale(1);
  pointer-events: auto;
  transition-delay: 0s;
}

.profile-avatar,
.profile-link {
  -webkit-user-drag: none;
}

.profile-link-body {
  margin-inline: 0.125rem;
}

.profile-link {
  transition: color 200ms ease, transform 260ms cubic-bezier(0.2, 1.3, 0.35, 1);
}

.profile-link:hover {
  transform: translateY(-2px) scale(1.08);
}

@media (max-height: 560px) {
  .profile-panel {
    padding-top: 1.25rem;
    padding-bottom: 4.5rem;
  }

  .profile-avatar {
    width: 7rem;
    height: 7rem;
  }

  .profile-avatar-shell {
    margin-bottom: 0.5rem;
  }
}
</style>
