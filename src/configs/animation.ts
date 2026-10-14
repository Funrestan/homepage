/**
 * 入场 / 身份 / 一言 / Donate 动画的时序与曲线。
 * 单位：时长 ms、模糊与位移 px、间距 rem；`offset` 是 Web Animations 的 0~1 进度。
 * 改完保存，Vite 会热更新。
 */
const animation = {
  // ═══════════ 入场：侧栏、头像发牌、bio 与链接分发、页脚 ═══════════
  entrance: {
    panelDesktopDuration: 920, // 侧栏入场时长（桌面）
    panelFullscreenDuration: 1100, // 侧栏入场时长（窄屏整屏）
    avatarDelay: 620, // 头像动画相对首帧的起始延迟
    avatarFadeEnd: 1200, // 头像淡入 + 去模糊结束的时间点
    dealStart: 1450, // 开始发牌（把 bio / 链接从名字处抛向各自落点）的时间点
    avatarDealHoldLead: 12, // 发牌前头像提前多少毫秒停止位移，用来对齐节奏
    dealCadence: 52, // 相邻两张牌的间隔
    dealDuration: 500, // 单张牌飞行时长
    compositionStart: 3000, // 头像开始移动到最终位置的时间点
    avatarEnd: 3380, // 头像位移结束的时间点
    steppedTravel: 0.58, // 发牌期间头像分步前移的总进度（0~1）
    panelDesktopOffsetPercent: -104, // 侧栏起始水平位移（%），负值表示从左侧滑入
    panelDesktopOpacity: 0.18, // 侧栏起始透明度
    panelDesktopBlur: 16, // 侧栏起始模糊
    panelFullscreenBlur: 18, // 窄屏整屏时侧栏起始模糊
    panelFullscreenScale: 1.025, // 窄屏整屏时侧栏起始缩放
    panelEasing: 'cubic-bezier(0.18, 0.82, 0.22, 1)', // 侧栏入场缓动
    avatarInitialBlur: 20, // 头像起始模糊
    avatarInitialScale: 0.82, // 头像起始缩放
    avatarStepScaleUp: 1.014, // 每次发牌瞬间头像的放大峰值
    avatarStepScaleDown: 0.992, // 每次发牌瞬间头像的回缩值
    avatarStepDuration: 34, // 单次发牌抖动的时长
    avatarInitialEasing: 'cubic-bezier(0.2, 0.82, 0.22, 1)', // 头像初次淡入缓动
    avatarStepEasing: 'cubic-bezier(0.18, 0.86, 0.22, 1)', // 发牌抖动缓动
    avatarFinalEasing: 'cubic-bezier(0.16, 0.88, 0.2, 1)', // 头像最后归位缓动
    dealBioBlur: 8, // bio 牌的起始模糊
    dealLinkBlur: 6, // 链接牌的起始模糊
    dealBioScale: 0.56, // bio 牌的起始缩放
    dealLinkScale: 0.48, // 链接牌的起始缩放
    dealRotation: 7, // 牌的起始旋转（相邻牌方向相反）
    dealRevealOffset: 0.2, // 牌在多早的进度变清晰（0~1）
    dealTailOffset: 0.74, // 抛尾动作开始的进度
    dealTailDistanceRatio: 0.14, // 抛尾时仍残留的位移比例
    dealTailLift: 7, // 抛尾时的上抬像素
    dealTailRotation: 1.4, // 抛尾时的反向旋转
    dealTailScale: 1.025, // 抛尾时的轻微放大
    dealEasing: 'cubic-bezier(0.17, 0.86, 0.2, 1)', // 牌的飞行缓动
    footerDuration: 620, // 页脚入场时长
    footerLead: 180, // 页脚比最后一张牌提前多少毫秒开始
    footerBlur: 7, // 页脚起始模糊
    footerOffsetY: 12, // 页脚起始下移像素
    footerEasing: 'ease-out', // 页脚缓动
  },

  // ═══════════ 身份：源发光 → 复制 → 合并 → 小写化解 → 名称回填 ═══════════
  identity: {
    glowLead: 380, // 抽取开始前，源 token 先发光多少毫秒
    copyDuration: 520, // 复制片段本身的时长
    copyStagger: 35, // 多个片段的错峰间隔
    mergeAfterExtraction: 480, // 抽取开始后多久开始合并片段
    resolveAfterExtraction: 840, // 抽取开始后多久片段变为最终小写单词
    finishAfterExtraction: 1170, // 抽取开始后多久进入完成态
    placementDuration: 520, // 名称回填时单个字的时长
    placementStagger: 35, // 名称回填的逐字错峰
    completeAfterPlacement: 580, // 回填结束后多久派发 complete 事件
    copyStartScale: 0.88, // 复制片段起始缩放
    copyStartOpacity: 0.08, // 复制片段起始透明度
    copyStartBlur: 1.5, // 复制片段起始模糊
    copyRevealOffset: 0.22, // 复制片段变清晰的进度
    copyEasing: 'cubic-bezier(0.16, 0.82, 0.22, 1)', // 复制片段缓动
    placementHoldOffset: 0.72, // 回填动画中停顿的进度点
    placementEasing: 'cubic-bezier(0.18, 0.88, 0.25, 1)', // 回填缓动
    sourceTransitionDuration: 300, // 源 token 状态过渡（写成 CSS 变量）
    workbenchTransitionDuration: 300, // 工作台过渡
    workbenchStartOffset: 5, // 工作台起始下移像素
    workbenchDoneScale: 0.98, // 工作台完成时的缩放
    partsInitialGap: 0.42, // 片段之间的初始间距
    partsGapDuration: 320, // 间距收敛时长
    partsFadeDuration: 220, // 片段淡入淡出时长
    partsFilterDuration: 260, // 片段滤镜过渡时长
    partColorDuration: 650, // 片段颜色过渡时长
    resolvedPartsBlur: 7, // 解析后片段的模糊
    resolvedEnterFadeDuration: 280, // 解析后片段淡入时长
    resolvedEnterMoveDuration: 360, // 解析后片段位移时长
    resolvedEnterBlur: 8, // 解析后片段入场起始模糊
    resolvedEnterScale: 0.86, // 解析后片段入场起始缩放
  },

  // ═══════════ 一言：容器收放、发牌、收牌 ═══════════
  hitokoto: {
    refreshRequestDelay: 180, // 点击刷新后延迟多久发请求（先做收牌动作）
    refreshGap: 150, // 收回旧文字与发出新文字之间的间隔
    shellFadeDuration: 620, // 容器淡入淡出时长
    shellMoveDuration: 720, // 容器高度 / 位移过渡时长
    shellStartBlur: 8, // 容器收起状态下的模糊
    shellStartOffsetY: -8, // 容器收起状态下的上移像素
    shellStartScale: 0.97, // 容器收起状态下的缩放
    shellMaximumHeight: '6rem', // 容器展开后的最大高度
    shellVisibleMarginTop: '0.1rem', // 容器展开后的上边距
    collectCadence: 30, // 收牌（旧文字飞头像）错峰
    collectDuration: 380, // 单枚收牌时长
    collectOpacity: 0.62, // 收牌途中的最低透明度
    dealCadence: 38, // 发牌（新文字从头像飞出）错峰
    dealDuration: 440, // 单枚发牌时长
    overlayLayer: 70, // 临时文字层的 z-index
    tokenSpacing: 0.32, // token 之间的间距（em）
    visibilityTransition: 120, // 可见性切换过渡
    dealStartOpacity: 0.58, // 发牌起始透明度
    dealStartBlur: 4, // 发牌起始模糊
    dealStartScale: 0.58, // 发牌起始缩放
    dealRotation: 6, // 发牌起始旋转
    dealRevealOffset: 0.24, // 发牌变清晰的进度
    dealTailOffset: 0.76, // 发牌抛尾开始的进度
    dealTailDistanceRatio: 0.12, // 发牌抛尾残留位移比例
    dealTailLift: 4, // 发牌抛尾上抬像素
    dealTailRotation: 1.2, // 发牌抛尾反向旋转
    dealTailScale: 1.02, // 发牌抛尾轻微放大
    dealEasing: 'cubic-bezier(0.17, 0.86, 0.2, 1)', // 发牌缓动
    collectColor: 'rgb(148 163 184)', // 收牌途中统一的颜色
    collectStartOpacity: 0.92, // 收牌起始透明度
    collectMidOffset: 0.72, // 收牌中段节点进度
    collectMidOpacity: 0.72, // 收牌中段透明度
    collectMidBlur: 0.8, // 收牌中段模糊
    collectMidDistanceRatio: 0.78, // 收牌中段位移比例
    collectMidLift: 5, // 收牌中段上抬像素
    collectMidRotation: 2, // 收牌中段旋转
    collectMidScale: 0.76, // 收牌中段缩放
    collectEndBlur: 1.8, // 收牌终点模糊
    collectEndScale: 0.48, // 收牌终点缩放
    collectEndRotation: 6, // 收牌终点旋转
    collectEasing: 'cubic-bezier(0.4, 0, 0.7, 0.25)', // 收牌缓动
  },

  // ═══════════ Donate：波纹 → 按钮飞向右侧板块中心 → 内容块弹出 ═══════════
  // 流程：按下 Donate → 释放范围大一倍的波纹 → donate 从下排移除（其余链接 FLIP 重排）
  //       → 按钮实体缓动到右侧板块中心 → 内容块带着这股动量弹出、反复阻尼弹
  donate: {
    // —— 按下瞬间的波纹 ——
    rippleRangeScale: 1, // 波纹影响半径与可见扩散范围的倍数
    rippleForceScale: 1, // 波纹力度倍数
    rippleSpeed: 3.2, // 折算成"速度"的力度参数（力度 = baseStrength + speed × speedStrength）
    reflowDuration: 420, // 下排增删条目后，其余条目的 FLIP 补位时长
    reflowEasing: 'cubic-bezier(0.2, 0.86, 0.24, 1)', // FLIP 补位缓动

    // —— 按钮实体飞行（起点 = 下排原位置，终点 = 右侧板块中心）——
    flightDuration: 270, // 飞行时长；缩短一点让整体节奏前移（原 300）
    flightEasing: 'cubic-bezier(0.5, 0.03, 0.4, 0.35)', // 起步极慢→中段最快→到点仍留约 1 倍平均速度（速度不为 0）
    flightScale: 1.14, // 落点时的缩放
    flightRotate: -8, // 落点时的旋转角度（度）

    // —— 与飞行的时间交接 ——
    panelLead: 80, // 内容块抢在按钮落点前多少毫秒启动（原 90，调大 → 启动更早）
    panelDelay: 0, // 内容块相对上述启动点的 WAAPI 延迟

    // —— 内容块的位移动量（沿按钮飞行方向）——
    panelTravel: 42, // 位移通道的总尺度（实际位移 = min(该值, 飞行距离 × 下面的比例)）
    panelTravelDistanceRatio: 0.12, // 位移上限 = 飞行距离 × 该比例，短距离时不会冲太远
    panelTravelStart: -3.5, // 位移通道的起始偏离 = panelTravel × 该值（负 = 起手在中心后方）
    panelTravelLaunch: 1, // 位移通道初速 = 按钮到达速度 × 该值（真正的"速度继承"）

    // —— 内容块的阻尼弹簧：缩放与位移的过冲都由它算出来，不再手写"第一次/第二次过冲" ——
    panelSpring: {
      frequency: 2.2, // 固有频率（Hz）：调小 → 一个来回更长、弹得更久（原 3）
      damping: 0.34, // 阻尼系数 ζ：<1 欠阻尼，调小 → 过冲更大、来回更多（原 0.48）
      settleEpsilon: 0.004, // 剩余振幅衰减到起始的该比例以内就收尾；调小 → 多弹几轮才停（原 0.008）
      sampleStep: 14, // 采样步长（ms）：越小越贴近解析曲线
      maximumDuration: 2800, // 兜底最长时长；调大 → 别把长反弹截断（原 1600）
    },
    panelStartScale: 0.05, // 缩放通道起始缩放（起始偏离 = 1 - 该值，配合模糊做出从一点崩开的感觉）
    panelScaleLaunch: 0.32, // 缩放通道初速 = 该值 × ω × |起始偏离|，越大越快撞向目标
    panelStartOpacity: 0.08, // 起始透明度
    panelStartBlur: 16, // 起始模糊
    panelRevealDuration: 200, // 模糊与透明度到位所需时间（不影响弹簧的位移与缩放）

    // —— 原按钮的消失（在内容块放大前期完成）——
    buttonFadeOffset: 0.34, // 在内容块时长的前百分之多少内完全消失
    buttonFadeScale: 0.5, // 消失过程中的缩放
    buttonFadeBlur: 10, // 消失过程中的模糊
    buttonFadeEasing: 'cubic-bezier(0.2, 0.9, 0.3, 1)', // 消失缓动（起手就走）

    // —— 内容文本逐条淡入 ——
    contentDelay: 130, // 相对内容块启动点的延迟
    contentDuration: 380, // 单条时长
    contentStagger: 45, // 相邻条目错峰
    contentOffsetY: 12, // 起始下移像素
    contentStartScale: 0.97, // 起始缩放
    contentStartBlur: 8, // 起始模糊
    contentEasing: 'cubic-bezier(0.18, 0.86, 0.24, 1)', // 内容淡入缓动

    // —— 收起（关闭按钮 / Esc / 点击面板外）：块与按钮共用下面这根弹簧 ——
    closeSpring: {
      frequency: 2.3, // 固有频率（Hz）：越大收得越快
      damping: 0.42, // 阻尼系数 ζ：回程过冲 ≈ 回程距离 × e^(-ζπ/√(1-ζ²))，0.62 时约 8%
      settleEpsilon: 0.003, // 剩余振幅衰减到起始的该比例以内就收尾（末帧一步到位落在落点）
      sampleStep: 14, // 采样步长（ms）
      maximumDuration: 1600, // 兜底最长时长
    },
    closeEndScale: 0.12, // 块收缩的终点缩放（弹簧的目标值）
    closeFollowRatio: 0.64, // 块跟随行程 = 按钮回程距离 × 该值（同一根弹簧，节奏完全同步）
    closeFadeOffset: 0.4, // 块在弹簧时长的前百分之多少内淡出到 0
    closeEndBlur: 12, // 淡出结束时的模糊
    returnLaunch: 0, // 按钮回程初速倍数（= 该值 × ω × 回程距离；>0 会更早到、过冲更大）
    returnFadeDuration: 200, // 按钮回程开始时淡入的时长

    minimumRightRegion: 320, // 右侧板块小于该宽度时（窄屏），改用视口中心作为落点

    // —— 窄屏（<768px，侧栏占满全屏）时内容块弹开的"崩飞"：解锁所有可碰撞组件 → 崩飞 → 隐形且不归位 → 关闭才恢复 ——
    scatter: {
      enable: true, // 只在窄屏生效；桌面端不崩飞
      speed: 4, // 冲击波折算成"速度"的力度（力度 = baseStrength + speed × speedStrength）
      radiusScale: 3, // 冲击波范围倍数（默认半径 300px × 该值）
      forceScale: 3, // 冲击波力度倍数
      radialScale: 45, // 径向冲量倍数：波纹默认以 Z 轴冲量为主，要"横向崩飞"就得把它放大（默认冲量只有 0.035）
      depthScale: 0.35, // Z 轴冲量倍数：调小就不那么朝观众方向弹
      delay: 240, // 弹开后多久开始隐形（先让它们飞一段）
      fadeOutDuration: 620, // 崩飞后"慢淡出"隐形所需时长（写在 CSS 变量 --donate-scatter-fade-out）
      fadeInDuration: 120, // 收起时"快淡入"复现所需时长（沿用你调的 120，写在 --donate-scatter-fade-in）
    },

    // —— 渠道列表 ⇄ 收款码：点选项后列表淡出、收款码淡入；点收款码再淡回列表 ——
    channelSwitch: {
      fadeOutDuration: 180, // 旧视图淡出时长
      fadeInDuration: 320, // 新视图淡入时长
      blur: 8, // 两端起始/结束的模糊
      offsetY: 12, // 淡入时上浮的距离
      scale: 0.97, // 淡入时的起始缩放
      resizeDuration: 240, // 两个视图高度不同（收款码更高）时，面板高度的过渡时长
      easing: 'cubic-bezier(0.18, 0.86, 0.24, 1)', // 淡入与高度过渡的缓动
    },
  },
}

export default animation