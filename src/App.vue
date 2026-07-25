<script setup lang="ts">
import SiteConfig from './configs/site.json';
import AuthorInfo from './configs/author.json';

import { Icon } from '@iconify/vue'
import AnimatedIdentity from './components/AnimatedIdentity.vue';
import BackgroundInfo from './components/BackgroundInfo.vue';
import PhysicsItem from './components/PhysicsItem.vue';
import { onBeforeUnmount, onMounted, ref } from 'vue';
// set background
var defaultBackground = `url(${SiteConfig['background-img']})`;
var darkBackground = `url(${SiteConfig['darkmode-background-img']})`;

const usingDarkBackground = ref(false);
const setCurrentTheme = () => {
  const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  usingDarkBackground.value = isDarkMode && darkBackground.length > 5; // url() is 5 characters
}

const fetchHitokoto = async () => {
  const hitokotoUrl = SiteConfig.hitokoto?.url || 'https://international.v1.hitokoto.cn';
  const response = await fetch(hitokotoUrl);
  const data = await response.json();
  var hitokotoCtx = data.hitokoto || '';
  var hitokotoFrom = data.from || '';
  if (hitokotoCtx.length>0 && hitokotoFrom.length>0) {
    document.getElementById('hitokotoCtx')!.textContent = `「${hitokotoCtx}」`;
    document.getElementById('hitokotoFrom')!.textContent = `—— ${hitokotoFrom}`;
    document.getElementById('hitokotoDiv')!.classList.remove('opacity-0');
    document.getElementById('hitokotoDiv')!.classList.add('max-h-10');
  }
}

const refreshHitokoto = () => {
  document.getElementById('hitokotoDiv')!.classList.add('opacity-0');
  document.getElementById('hitokotoDiv')!.classList.remove('max-h-10');
  setTimeout(() => {
    fetchHitokoto();
  }, 500);
}

setCurrentTheme();
fetchHitokoto();
document.documentElement.style.setProperty('--default-background', defaultBackground);
document.documentElement.style.setProperty('--dark-background', darkBackground);

let colorSchemeQuery: MediaQueryList | null = null;
const handleColorSchemeChange = () => setCurrentTheme();

onMounted(() => {
  colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  colorSchemeQuery.addEventListener('change', handleColorSchemeChange);
});

onBeforeUnmount(() => {
  if (!colorSchemeQuery) return;
  colorSchemeQuery.removeEventListener('change', handleColorSchemeChange);
});
</script>

<template>
  <div class="flex h-screen w-screen">
    <div class="profile-panel md:w-5/16 w-full h-full
                bg-white/50 border-white/50
                dark:bg-black/60 dark:border-gray-700/50
                backdrop-blur-2xl border-r transition-all duration-300
                shadow-[10px_0px_30px_rgba(0,0,0,0.25)] p-10
                flex flex-col items-center justify-center">
      <PhysicsItem :mass="2.7" :influence="0.72" :cooldown="1100" shape="round" class="profile-avatar-shell">
        <img :src="AuthorInfo.avatar" alt="avatar" draggable="false"
          class="profile-avatar h-40 w-40 rounded-full shadow-xl">
      </PhysicsItem>
      <AnimatedIdentity :name="AuthorInfo.name" />
      <!-- 一言 -->
      <div id="hitokotoDiv" v-if="SiteConfig.hitokoto.enable" 
          class="duration-500 transition-all opacity-0 max-h-0"
          @click="refreshHitokoto()">
        <h1 id="hitokotoCtx" class="text-sm text-gray-600 dark:text-gray-300">&nbsp</h1>
        <h1 id="hitokotoFrom" class="text-sm text-gray-600 dark:text-gray-300 text-right">&nbsp</h1>
      </div>
      <div class="profile-links flex text-2xl gap-2">
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
    <footer class="profile-footer absolute bottom-0 md:w-5/16 w-full mb-3
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
