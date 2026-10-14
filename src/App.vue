<script setup lang="ts">
import SiteConfig from './configs/site';
import AuthorInfo from './configs/author';
import PhysicsConfig from './configs/physics';
import UiConfig from './configs/ui';
import DonateConfig from './configs/donate';

import { Icon } from '@iconify/vue'
import AnimatedIdentity from './components/AnimatedIdentity.vue';
import BackgroundInfo from './components/BackgroundInfo.vue';
import DonatePanel from './components/DonatePanel.vue';
import DeveloperOrbs from './components/DeveloperOrbs.vue';
import FriendFlight from './components/FriendFlight.vue';
import HitokotoTokens from './components/HitokotoTokens.vue';
import PhysicsItem from './components/PhysicsItem.vue';
import ReturnTimer from './components/ReturnTimer.vue';
import AnimationConfig from './configs/animation';
import FriendsConfig from './configs/friends';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, type ComponentPublicInstance } from 'vue';
import { isDonateLink, isFriendLink, authorLinks, type ProfileLink } from './composables/profileLink';
import type { DeveloperMagnet } from './composables/useDeveloperOrbs';
import { settleSoftPhysics, triggerSoftPhysicsRipple } from './composables/useSoftPhysics';
import {
  claimRightStage,
  DONATE_STAGE_OWNER,
  RIGHT_STAGE_EVENT,
} from './composables/blockStage';
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
const donateItem = ref<ElementHandle | null>(null);
const donatePanel = ref<InstanceType<typeof DonatePanel> | null>(null);
const donateSlotHidden = ref(false);
const donateInRow = ref(true);
const donatePhase = ref<'idle' | 'opening' | 'open' | 'closing'>('idle');
const friendItem = ref<ElementHandle | null>(null);
const friendFlight = ref<InstanceType<typeof FriendFlight> | null>(null);
const developerOrbs = ref<InstanceType<typeof DeveloperOrbs> | null>(null);
const friendSlotHidden = ref(false);
const friendInRow = ref(true);
const friendPhase = ref<'idle' | 'opening' | 'open' | 'closing'>('idle');
/** 右侧最后打开的是哪一个：Esc 只收它（两者可以同时在，不能一次全关） */
const lastRightBlock = ref<'donate' | 'friends' | null>(null);
let refreshTimer: number | null = null;
let hitokotoRefreshing = false;
let themeOverride: boolean | null = null;

const donateFeatureEnabled = DonateConfig.enable && authorLinks.some(isDonateLink);
const donateLinkEntry = authorLinks.find(isDonateLink) ?? null;
const friendsFeatureEnabled = FriendsConfig.enable && authorLinks.some(isFriendLink);
const friendLinkEntry = authorLinks.find(isFriendLink) ?? null;
// 飞走的那条链接是否还占着下排的位置（friends.row.reflow 决定它是"被移除补位"还是"留个空位"）
const visibleLinks = computed(() => authorLinks.filter((link) => {
  if (donateFeatureEnabled && isDonateLink(link) && !donateInRow.value) return false;
  if (friendsFeatureEnabled && isFriendLink(link) && !friendInRow.value) return false;
  return true;
}));

const applyTheme = (isDark: boolean) => {
  usingDarkBackground.value = isDark;
  document.documentElement.classList.toggle('dark', isDark);
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
}

const setCurrentTheme = () => {
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(themeOverride ?? systemPrefersDark);
}

const toggleTheme = () => {
  themeOverride = !usingDarkBackground.value;
  applyTheme(themeOverride);
}

const themeToggleLabel = computed(() => usingDarkBackground.value
  ? `Switch to ${UiConfig.themeToggle.lightTooltip} theme`
  : `Switch to ${UiConfig.themeToggle.darkTooltip} theme`)
const themeToggleTooltip = computed(() => usingDarkBackground.value
  ? UiConfig.themeToggle.lightTooltip
  : UiConfig.themeToggle.darkTooltip)

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

type DonatePoint = { x: number; y: number }
type SlotSnapshot = { element: HTMLElement; left: number }

const setLinkItem = (link: ProfileLink, element: Element | ComponentPublicInstance | null) => {
  const handle = element as unknown as ElementHandle | null;
  if (isDonateLink(link)) donateItem.value = handle;
  if (isFriendLink(link)) friendItem.value = handle;
}

/** 右侧板块（侧栏之右的整块区域）的中心；窄屏时退回视口中心。 */
const donateTargetCenter = (): DonatePoint => {
  const rect = profilePanel.value?.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const rightRegion = rect ? viewportWidth - rect.right : 0;
  if (!rect || rightRegion < AnimationConfig.donate.minimumRightRegion) {
    return { x: viewportWidth / 2, y: viewportHeight / 2 };
  }
  return { x: rect.right + rightRegion / 2, y: viewportHeight / 2 };
}

/** 友链的落点：右侧板块"上半场的中心"（y = 视口高度 × upperHalfRatio）；窄屏退回视口上中部。 */
const friendTargetCenter = (): DonatePoint => {
  const { target } = FriendsConfig;
  const rect = profilePanel.value?.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const rightRegion = rect ? viewportWidth - rect.right : 0;
  if (!rect || rightRegion < target.minimumRightRegion) {
    return {
      x: viewportWidth * target.narrowX,
      y: viewportHeight * target.narrowYRatio,
    };
  }
  return { x: rect.right + rightRegion / 2, y: viewportHeight * target.upperHalfRatio };
}

/** 某个链接条目在屏幕上的视觉盒子（取内层 content，避开物理条目自身的位移叠算）。 */
const linkVisualRect = (link: ProfileLink) => {
  const holder = isFriendLink(link) ? friendItem.value : donateItem.value;
  const element = holder?.getElement();
  const visual = element?.querySelector<HTMLElement>('.physics-item__content') ?? element;
  return visual ? visual.getBoundingClientRect() : null;
}

const centerOf = (rect: DOMRect): DonatePoint => ({
  x: rect.left + rect.width / 2,
  y: rect.top + rect.height / 2,
});

const snapshotSlots = (): SlotSnapshot[] => Array.from(
  profileLinks.value?.querySelectorAll<HTMLElement>('.profile-link-slot') ?? [],
).map((element) => ({ element, left: element.getBoundingClientRect().left }));

/** 下排增删条目后，用 FLIP 让剩下的条目滑到新位置。 */
const playSlotReflow = (
  snapshot: SlotSnapshot[],
  duration = AnimationConfig.donate.reflowDuration,
  easing = AnimationConfig.donate.reflowEasing,
) => {
  snapshot.forEach(({ element, left }) => {
    const delta = left - element.getBoundingClientRect().left;
    if (Math.abs(delta) < 0.5) return;
    element.animate([
      { offset: 0, transform: `translate3d(${delta.toFixed(2)}px, 0, 0)` },
      { offset: 1, transform: 'translate3d(0, 0, 0)' },
    ], { duration, easing });
  });
}

/** 礼物面板顶缘的 y（面板不在或让位关了时 null）：友链据此决定要不要往上让。 */
const donatePanelKeepOutTop = (): number | null => {
  if (!FriendsConfig.avoid.enable || donatePhase.value === 'idle') return null;
  const host = document.querySelector<HTMLElement>('.donate-panel-host');
  return host ? host.getBoundingClientRect().top : null;
}

const syncFriendKeepOut = () => {
  friendFlight.value?.setKeepOutTop(donatePanelKeepOutTop());
}

/** 开发者小球每帧拿它当磁铁：友链球悬停时它们被吸住，友链球归位就断磁 */
const friendMagnet = (): DeveloperMagnet | null => friendFlight.value?.getMagnet() ?? null

let panelResizeObserver: ResizeObserver | null = null;
/** 面板高度变化（列表 ⇄ 收款码）时同步友链的让位；只在友链开着时才观察。 */
const watchDonatePanelSize = () => {
  panelResizeObserver?.disconnect();
  panelResizeObserver = null;
  if (friendPhase.value !== 'open') return;
  const host = document.querySelector<HTMLElement>('.donate-panel-host');
  if (!host || typeof ResizeObserver === 'undefined') return;
  panelResizeObserver = new ResizeObserver(() => syncFriendKeepOut());
  panelResizeObserver.observe(host);
}

const handleLinkClick = (link: ProfileLink, event: MouseEvent) => {
  if (donateFeatureEnabled && isDonateLink(link)) {
    event.preventDefault();
    void openDonate();
    return;
  }
  if (friendsFeatureEnabled && isFriendLink(link)) {
    // 飞出去之后原位那条已经不在了（或已隐藏），所以正常路径下"再次点击"打在飞行实体上；
    // 这里保留判断是为了兜底：万一它还留在下排，点它也能收回来。
    event.preventDefault();
    if (friendPhase.value === 'idle') void openFriends();
    else if (friendPhase.value === 'open') void closeFriends();
  }
}

const openDonate = async () => {
  if (!donateFeatureEnabled || !donateLinkEntry || donatePhase.value !== 'idle') return;
  const originRect = linkVisualRect(donateLinkEntry);
  if (!originRect) return;
  const origin = centerOf(originRect);
  const target = donateTargetCenter();
  const { rippleRangeScale, rippleForceScale, rippleSpeed } = AnimationConfig.donate;

  donatePhase.value = 'opening';
  // 占用右侧中心：未来别的块照同一协议 claim / 监听，互相让位
  claimRightStage(DONATE_STAGE_OWNER);

  // 按下即释放范围大一倍的波纹，随后 donate 从下排移除。
  triggerSoftPhysicsRipple(origin.x, origin.y, rippleSpeed, {
    radiusScale: rippleRangeScale,
    forceScale: rippleForceScale,
    visualRangeScale: rippleRangeScale,
    bypassInterval: true,
  });
  const slots = snapshotSlots();
  donateInRow.value = false;
  await nextTick();
  playSlotReflow(slots);

  // 按钮实体缓动到右侧板块中心，再由中心渐显放大内容块。
  const panel = donatePanel.value;
  if (!panel) {
    donateInRow.value = true;
    donatePhase.value = 'idle';
    return;
  }
  await panel.openFrom(origin, target);
  donatePhase.value = 'open';
  lastRightBlock.value = 'donate';
  // 面板长出来了：若友链正开着，让它按面板顶缘往上让
  syncFriendKeepOut();
  watchDonatePanelSize();
}

/**
 * 「友链」飞出去：同一个图标实体飘到右侧板块上半场的中心，并在途中放大到 3 倍。
 * 与 Donate 同节奏：波纹 → 下排腾位（FLIP）→ 一段缓动飞过去（到点速度不为 0）
 * → 缩放挂阻尼弹簧（过冲后回中）；真身留在下排（先隐藏占位），飞的是它的克隆体。
 *
 * 注意：它虽然落在右侧板块里，但**不独占**——礼物面板在中部、它在上半场，两者可以同时在，
 * 所以这里既不 claimRightStage、也不因为别人的 claim 而收起（与 Donate 互不影响）。
 */
const openFriends = async () => {
  if (!friendsFeatureEnabled || !friendLinkEntry || friendPhase.value !== 'idle') return;
  const originRect = linkVisualRect(friendLinkEntry);
  if (!originRect) return;
  const origin = centerOf(originRect);
  const target = friendTargetCenter();
  const { ripple, row } = FriendsConfig;

  friendPhase.value = 'opening';

  triggerSoftPhysicsRipple(origin.x, origin.y, ripple.speed, {
    radiusScale: ripple.rangeScale,
    forceScale: ripple.forceScale,
    visualRangeScale: ripple.rangeScale,
    bypassInterval: true,
  });

  // 下排腾位：reflow = 移除并让别人滑过来补位；否则留个空位、只把真身藏起来
  const slots = snapshotSlots();
  if (row.reflow) friendInRow.value = false;
  else friendSlotHidden.value = true;
  await nextTick();
  playSlotReflow(slots, row.reflowDuration, row.reflowEasing);

  const flight = friendFlight.value;
  if (!flight) {
    friendInRow.value = true;
    friendSlotHidden.value = false;
    friendPhase.value = 'idle';
    return;
  }
  await flight.openFrom(origin, target, donatePanelKeepOutTop());
  friendPhase.value = 'open';
  lastRightBlock.value = 'friends';
  watchDonatePanelSize();
  // 友链球悬停在右上方了：开发者小球从屏幕外下方升上来
  developerOrbs.value?.begin();
}

/**
 * 归位落定：与真实拖拽归位同款反馈——在原位置丢一圈波纹（推动邻居），
 * 并让条目自己做一次急停挤压，避免"按钮是 clone 飞回来的"就漏掉物理反馈。
 */
const playSettleRipple = (point: DonatePoint, holder: ElementHandle | null = donateItem.value) => {
  triggerSoftPhysicsRipple(point.x, point.y, PhysicsConfig.wave.returnSpeed);
  const element = holder?.getElement();
  if (!element) return;
  element.classList.remove('is-impacting');
  void element.offsetWidth;
  element.classList.add('is-impacting');
  window.setTimeout(
    () => element.classList.remove('is-impacting'),
    PhysicsConfig.return.impactClassDuration,
  );
}

const closeDonate = async () => {
  if (donatePhase.value !== 'open' || !donateLinkEntry) return;
  const panel = donatePanel.value;
  if (!panel) return;
  donatePhase.value = 'closing';
  const center = donateTargetCenter();

  // 先把 donate 放回下排（先隐藏），量出落点，其余条目 FLIP 让位；
  // 然后块与按钮共用一根弹簧同时动：块跟着按钮往回缩，按钮过冲过落点再弹回。
  const slots = snapshotSlots();
  donateSlotHidden.value = true;
  donateInRow.value = true;
  await nextTick();
  playSlotReflow(slots);

  const landingRect = linkVisualRect(donateLinkEntry);
  const landing = landingRect ? centerOf(landingRect) : center;
  await panel.closeTo(center, landing);

  donateSlotHidden.value = false;
  panel.hideFlight();
  await nextTick();
  playSettleRipple(landing, donateItem.value);
  donatePhase.value = 'idle';
  // 面板收了：友链回到上半场中心，观察也撤掉
  syncFriendKeepOut();
  watchDonatePanelSize();
}

/** 再点一下放大后的友链（或 Esc）：行程与缩放同步缩回原位，落定补波纹。 */
const closeFriends = async () => {
  if (friendPhase.value !== 'open' || !friendLinkEntry) return;
  const flight = friendFlight.value;
  if (!flight) return;
  friendPhase.value = 'closing';
  // 磁力一断，开发者小球就各自随重力掉出屏幕外销毁
  developerOrbs.value?.release();
  const target = friendTargetCenter();
  const { row } = FriendsConfig;

  // 先把图标放回下排（先隐藏），量出落点，其余条目 FLIP 让位
  const slots = snapshotSlots();
  friendSlotHidden.value = true;
  friendInRow.value = true;
  await nextTick();
  playSlotReflow(slots, row.reflowDuration, row.reflowEasing);

  const landingRect = linkVisualRect(friendLinkEntry);
  const landing = landingRect ? centerOf(landingRect) : target;
  await flight.closeTo(landing);

  friendSlotHidden.value = false;
  flight.hideFlight();
  await nextTick();
  if (FriendsConfig.settleRipple) playSettleRipple(landing, friendItem.value);
  friendPhase.value = 'idle';
  watchDonatePanelSize();
}

/**
 * 双击头像：让全体元素进入"归位模式"（由归位弹簧拉回，不是瞬移），
 * 落定时照常出波纹/挤压，并按 ui.ts 的 stabilize 设定碰撞冷却。
 */
const stabilizeAllElements = () => {
  const { stabilize } = UiConfig;
  settleSoftPhysics({
    returnBoost: stabilize.returnBoost,
    collisionCooldown: stabilize.collisionCooldown,
    settleRipple: stabilize.settleRipple,
    clearWaves: stabilize.clearWaves,
  });
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
      filter: `blur(${entrance.avatarInitialBlur}px)`,
      transform: avatarTransform(0, entrance.avatarInitialScale),
      easing: entrance.avatarInitialEasing,
    },
    {
      offset: avatarOffsetAt(entrance.avatarFadeEnd),
      opacity: 1,
      filter: 'blur(0)',
      transform: avatarTransform(0),
      easing: 'linear',
    },
    {
      offset: avatarOffsetAt(dealStart - entrance.avatarDealHoldLead),
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
        transform: avatarTransform(previousProgress, entrance.avatarStepScaleUp),
        easing: entrance.avatarStepEasing,
      },
      {
        offset: avatarOffsetAt(dealTime + entrance.avatarStepDuration),
        opacity: 1,
        filter: 'blur(0)',
        transform: avatarTransform(nextProgress, entrance.avatarStepScaleDown),
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
      easing: entrance.avatarFinalEasing,
    },
    { offset: 1, opacity: 1, filter: 'blur(0)', transform: avatarTransform(1) },
  );

  registerEntrance(panel.animate(fullWidthPanel ? [
    {
      opacity: 0,
      filter: `blur(${entrance.panelFullscreenBlur}px)`,
      transform: `scale(${entrance.panelFullscreenScale})`,
    },
    { opacity: 1, filter: 'blur(0)', transform: 'scale(1)' },
  ] : [
    {
      opacity: entrance.panelDesktopOpacity,
      filter: `blur(${entrance.panelDesktopBlur}px)`,
      transform: `translate3d(${entrance.panelDesktopOffsetPercent}%, 0, 0)`,
    },
    { opacity: 1, filter: 'blur(0)', transform: 'translate3d(0, 0, 0)' },
  ], {
    duration: fullWidthPanel ? entrance.panelFullscreenDuration : entrance.panelDesktopDuration,
    easing: entrance.panelEasing,
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
        filter: `blur(${kind === 'bio' ? entrance.dealBioBlur : entrance.dealLinkBlur}px)`,
        transform: `translate3d(${offsetX}px, ${offsetY}px, 0) rotate(${direction * entrance.dealRotation}deg) scale(${kind === 'bio' ? entrance.dealBioScale : entrance.dealLinkScale})`,
      },
      {
        offset: entrance.dealRevealOffset,
        opacity: 1,
        filter: 'blur(0)',
      },
      {
        offset: entrance.dealTailOffset,
        opacity: 1,
        filter: 'blur(0)',
        transform: `translate3d(${offsetX * entrance.dealTailDistanceRatio}px, ${offsetY * entrance.dealTailDistanceRatio - entrance.dealTailLift}px, 0) rotate(${direction * -entrance.dealTailRotation}deg) scale(${entrance.dealTailScale})`,
      },
      { opacity: 1, filter: 'blur(0)', transform: 'translate3d(0, 0, 0) rotate(0) scale(1)' },
    ], {
      duration: entrance.dealDuration,
      delay: dealStart + index * dealCadence,
      easing: entrance.dealEasing,
      fill: 'backwards',
    }));
  });

  if (profileFooter.value) {
    registerEntrance(profileFooter.value.animate([
      {
        opacity: 0,
        filter: `blur(${entrance.footerBlur}px)`,
        transform: `translateY(${entrance.footerOffsetY}px)`,
      },
      { opacity: 1, filter: 'blur(0)', transform: 'translateY(0)' },
    ], {
      duration: entrance.footerDuration,
      delay: dealStart + dealTargets.length * dealCadence - entrance.footerLead,
      easing: entrance.footerEasing,
      fill: 'backwards',
    }));
  }
}

setCurrentTheme();
document.documentElement.style.setProperty('--default-background', defaultBackground);
document.documentElement.style.setProperty('--dark-background', darkBackground);
document.documentElement.style.setProperty('--physics-perspective', PhysicsConfig.visual.perspective);
document.documentElement.style.setProperty('--physics-active-layer', String(PhysicsConfig.visual.activeLayer));
document.documentElement.style.setProperty('--physics-outline-inset', PhysicsConfig.visual.outlineInset);
document.documentElement.style.setProperty('--physics-ripple-size', PhysicsConfig.visual.rippleSize);
document.documentElement.style.setProperty('--physics-ripple-duration', PhysicsConfig.visual.rippleDuration);
document.documentElement.style.setProperty('--physics-ripple-end-scale', String(PhysicsConfig.visual.rippleEndScale));
document.documentElement.style.setProperty('--physics-impact-duration', PhysicsConfig.visual.impactDuration);
document.documentElement.style.setProperty('--physics-pickup-duration', PhysicsConfig.visual.pickupDuration);
document.documentElement.style.setProperty('--donate-scatter-fade-in', `${AnimationConfig.donate.scatter.fadeInDuration}ms`);
document.documentElement.style.setProperty('--donate-scatter-fade-out', `${AnimationConfig.donate.scatter.fadeOutDuration}ms`);
document.documentElement.style.setProperty('--hitokoto-shell-fade-duration', `${AnimationConfig.hitokoto.shellFadeDuration}ms`);
document.documentElement.style.setProperty('--hitokoto-shell-move-duration', `${AnimationConfig.hitokoto.shellMoveDuration}ms`);
document.documentElement.style.setProperty('--hitokoto-shell-start-blur', `${AnimationConfig.hitokoto.shellStartBlur}px`);
document.documentElement.style.setProperty('--hitokoto-shell-start-offset-y', `${AnimationConfig.hitokoto.shellStartOffsetY}px`);
document.documentElement.style.setProperty('--hitokoto-shell-start-scale', String(AnimationConfig.hitokoto.shellStartScale));
document.documentElement.style.setProperty('--hitokoto-shell-maximum-height', AnimationConfig.hitokoto.shellMaximumHeight);
document.documentElement.style.setProperty('--hitokoto-shell-visible-margin-top', AnimationConfig.hitokoto.shellVisibleMarginTop);
document.documentElement.style.setProperty('--theme-transition-duration', `${UiConfig.themeToggle.transitionDuration}ms`);
document.documentElement.style.setProperty('--theme-background-fade-duration', `${UiConfig.themeToggle.backgroundFadeDuration}ms`);
document.documentElement.style.setProperty('--theme-transition-easing', UiConfig.themeToggle.transitionEasing);

/**
 * 右侧板块的独占协议：谁要"整片右侧区域"就 claim，别人让位。
 * Donate 走这套；「友链」不走——它只占上半场（跟礼物面板不冲突，可以同时在），
 * 所以既不 claim，也不会因为别人的 claim 而收起。
 */
const handleRightStageClaim = (event: Event) => {
  const owner = (event as CustomEvent<{ owner?: string }>).detail?.owner;
  if (!owner || owner === DONATE_STAGE_OWNER) return;
  void closeDonate();
}

/**
 * Esc：收起"最后打开的那一个"。
 * 右侧板块的上半场（友链）与中部（礼物面板）现在互不冲突、可以同时开着，
 * 所以不能两个组件各听一次 Esc（那会一次全关），统一在这里按打开顺序收。
 */
const handleRightStageEsc = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return;
  const friendOpen = friendPhase.value === 'open' && FriendsConfig.escToClose;
  const donateOpen = donatePhase.value === 'open';
  if (!friendOpen && !donateOpen) return;
  if (lastRightBlock.value === 'friends' && friendOpen) {
    void closeFriends();
    return;
  }
  if (lastRightBlock.value === 'donate' && donateOpen) {
    void closeDonate();
    return;
  }
  if (friendOpen) void closeFriends();
  else void closeDonate();
}

let colorSchemeQuery: MediaQueryList | null = null;
const handleColorSchemeChange = () => {
  if (themeOverride === null) setCurrentTheme();
};

onMounted(() => {
  colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  colorSchemeQuery.addEventListener('change', handleColorSchemeChange);
  window.addEventListener(RIGHT_STAGE_EVENT, handleRightStageClaim);
  window.addEventListener('keydown', handleRightStageEsc);
  void fetchHitokoto();
  void runEntranceAnimation();
});

onBeforeUnmount(() => {
  if (colorSchemeQuery) colorSchemeQuery.removeEventListener('change', handleColorSchemeChange);
  window.removeEventListener(RIGHT_STAGE_EVENT, handleRightStageClaim);
  window.removeEventListener('keydown', handleRightStageEsc);
  panelResizeObserver?.disconnect();
  panelResizeObserver = null;
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
      <PhysicsItem
        ref="avatarItem"
        :mass="PhysicsConfig.presets.avatar.mass"
        :influence="PhysicsConfig.presets.avatar.influence"
        :cooldown="PhysicsConfig.presets.avatar.cooldown"
        :settle-collision-cooldown="PhysicsConfig.presets.avatar.settleCollisionCooldown"
        shape="round"
        class="profile-avatar-shell"
        title="双击快速归位所有元素"
        @double-tap="stabilizeAllElements"
      >
        <ReturnTimer v-if="UiConfig.returnTimer.enable" />
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
        <div v-for="value in visibleLinks" :key="value.name" class="profile-link-slot">
          <PhysicsItem
            :ref="(element) => setLinkItem(value, element)"
            :mass="PhysicsConfig.presets.link.mass"
            :influence="PhysicsConfig.presets.link.influence"
            :cooldown="PhysicsConfig.presets.link.cooldown"
            :settle-collision-cooldown="PhysicsConfig.presets.link.settleCollisionCooldown"
            shape="compact"
            class="profile-link-body"
            :class="{
              'is-slot-hidden': (donateSlotHidden && isDonateLink(value))
                || (friendSlotHidden && isFriendLink(value)),
            }"
          >
            <a :href="value.url" target="_blank" rel="noopener noreferrer" draggable="false"
                  class="profile-link text-gray-700 hover:text-gray-900
                        dark:text-gray-300 dark:hover:text-white
                        transition-all duration-300 group relative
                        flex-col flex items-center justify-center"
                  :style="{
                    '--icon-default': value.defaultColor || undefined,
                    '--icon-hover': value.hoverColor || undefined,
                  }"
                  @click="handleLinkClick(value, $event)">
                <Icon :icon="value.icon" class="icon-color" />
                <div class="h-full text-sm absolute pt-10 opacity-0 transition-all duration-200
                            hover:opacity-100">
                  {{ value.name }}
                </div>
            </a>
          </PhysicsItem>
        </div>
        <div v-if="UiConfig.themeToggle.enable" class="profile-link-slot">
          <PhysicsItem
            :mass="PhysicsConfig.presets.link.mass"
            :influence="PhysicsConfig.presets.link.influence"
            :cooldown="PhysicsConfig.presets.link.cooldown"
            :settle-collision-cooldown="PhysicsConfig.presets.link.settleCollisionCooldown"
            shape="compact"
            class="profile-link-body"
          >
            <button
              type="button"
              class="profile-link theme-toggle text-gray-700 hover:text-gray-900
                    dark:text-gray-300 dark:hover:text-white
                    transition-all duration-300 group relative
                    flex-col flex items-center justify-center"
              :aria-label="themeToggleLabel"
              :aria-pressed="usingDarkBackground"
              :title="themeToggleLabel"
              @click.stop="toggleTheme"
              @dragstart.prevent
            >
              <span class="theme-toggle__icons" aria-hidden="true">
                <Icon
                  :icon="UiConfig.themeToggle.darkIcon"
                  class="icon-color theme-toggle__icon theme-toggle__icon--dark"
                />
                <Icon
                  :icon="UiConfig.themeToggle.lightIcon"
                  class="icon-color theme-toggle__icon theme-toggle__icon--light"
                />
              </span>
              <div class="h-full text-sm absolute pt-10 opacity-0 transition-all duration-200
                          group-hover:opacity-100">
                {{ themeToggleTooltip }}
              </div>
            </button>
          </PhysicsItem>
        </div>
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
    <DonatePanel ref="donatePanel" @close="closeDonate" />
    <FriendFlight ref="friendFlight" @close="closeFriends" />
    <DeveloperOrbs ref="developerOrbs" :get-magnet="friendMagnet" />
  </div>
</template>

<style scoped>
.icon-color {
  color: var(--icon-default, currentColor);
  transition: color var(--theme-transition-duration) var(--theme-transition-easing);
}

.group:hover .icon-color {
  color: var(--icon-hover, currentColor);
}

.profile-avatar-shell {
  flex: 0 0 auto;
  margin-bottom: 1rem;
  border-radius: 999px;
}

.profile-panel,
.profile-footer {
  transition-duration: var(--theme-transition-duration);
  transition-timing-function: var(--theme-transition-easing);
}

.hitokoto-shell {
  width: 100%;
  min-height: 0;
  max-height: 0;
  margin-top: 0;
  overflow: hidden;
  opacity: 0;
  visibility: hidden;
  filter: blur(var(--hitokoto-shell-start-blur));
  transform:
    translateY(var(--hitokoto-shell-start-offset-y))
    scale(var(--hitokoto-shell-start-scale));
  transform-origin: top center;
  pointer-events: none;
  transition:
    opacity var(--hitokoto-shell-fade-duration) ease,
    filter var(--hitokoto-shell-fade-duration) ease,
    transform var(--hitokoto-shell-move-duration) cubic-bezier(0.18, 0.9, 0.24, 1),
    max-height var(--hitokoto-shell-move-duration) cubic-bezier(0.18, 0.9, 0.24, 1),
    margin-top var(--hitokoto-shell-move-duration) cubic-bezier(0.18, 0.9, 0.24, 1),
    visibility 0s linear var(--hitokoto-shell-move-duration);
}

.hitokoto-shell.is-visible {
  max-height: var(--hitokoto-shell-maximum-height);
  margin-top: var(--hitokoto-shell-visible-margin-top);
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

.profile-link-slot {
  display: flex;
  align-items: center;
  justify-content: center;
}

.profile-link-slot .is-slot-hidden {
  visibility: hidden;
}

.profile-link {
  transition:
    color var(--theme-transition-duration) var(--theme-transition-easing),
    transform 260ms cubic-bezier(0.2, 1.3, 0.35, 1);
}

.profile-link:hover {
  transform: translateY(-2px) scale(1.08);
}

.theme-toggle__icons {
  position: relative;
  display: inline-grid;
  width: 1em;
  height: 1em;
  place-items: center;
}

.theme-toggle__icon {
  position: absolute;
  grid-area: 1 / 1;
  transition:
    opacity var(--theme-transition-duration) var(--theme-transition-easing),
    transform var(--theme-transition-duration) var(--theme-transition-easing),
    color var(--theme-transition-duration) var(--theme-transition-easing);
}

.theme-toggle__icon--dark {
  opacity: 1;
  transform: rotate(0deg) scale(1);
}

.theme-toggle__icon--light {
  opacity: 0;
  transform: rotate(-95deg) scale(0.62);
}

:global(html.dark .theme-toggle__icon--dark) {
  opacity: 0;
  transform: rotate(95deg) scale(0.62);
}

:global(html.dark .theme-toggle__icon--light) {
  opacity: 1;
  transform: rotate(0deg) scale(1);
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
