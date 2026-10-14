/**
 * 软体物理：拖拽、惯性、碰撞、归位、波纹扰动，以及每帧的视觉变形。
 * 单位：时长 ms、距离 px、速度与冲量为无量纲的"每帧"量；delta 以名义帧（16.67ms）为 1。
 */
const physics = {
  // ═══════════ 默认值：未显式传参时的兜底 ═══════════
  defaults: {
    minimumMass: 0.35, // 质量下限（防止过轻导致冲量爆炸）
    minimumInfluence: 0.2, // 影响力下限
    mass: 1, // 默认质量：越大越"重"，被波纹推得越少
    influence: 1, // 默认影响力：越大越容易被波纹推动
    cooldown: 720, // 松手后的惯性冷却，结束后才开始归位
    settleCollisionCooldown: 520, // 归位落定后对碰撞免疫的时长
  },

  // ═══════════ 预设：各类元素的物理手感 ═══════════
  presets: {
    word: { // 可拖拽的单词（bio token）
      mass: 0.82, // 质量
      influence: 1.08, // 影响力
      cooldown: 760, // 惯性冷却
      settleCollisionCooldown: 520, // 落定后的碰撞免疫
    },
    container: { // 通用容器（PhysicsItem 的默认预设）
      mass: 1.4,
      influence: 1,
      cooldown: 820,
      settleCollisionCooldown: 520,
    },
    avatar: { // 头像
      mass: 2.7,
      influence: 0.72,
      cooldown: 1100,
      settleCollisionCooldown: 520,
    },
    link: { // 链接 / 主题按钮图标
      mass: 1.05,
      influence: 1.16,
      cooldown: 880,
      settleCollisionCooldown: 520,
    },
    hitokotoToken: { // 一言的文字 token
      mass: 0.72,
      influence: 1.08,
      cooldown: 760,
      settleCollisionCooldown: 1250, // 一言 token 更晚才允许再次碰撞
      contentFloatDelay: -1, // 正文 token 的浮动相位延迟（负值错开相位）
      sourceFloatDelay: -1.5, // 出处 token 的浮动相位延迟
    },
  },

  // ═══════════ 帧：时间步长与掉帧保护 ═══════════
  frame: {
    nominalDuration: 16.67, // 名义帧时长（60fps），delta 以此为 1
    minimumDelta: 0.35, // 单帧 delta 下限
    maximumDelta: 2.2, // 单帧 delta 上限（切后台 / 掉帧时防跳变）
  },

  // ═══════════ 绘制：每帧把状态翻译成 transform ═══════════
  paint: {
    maximumCompression: 0.2, // 压缩量上限
    depthScaleFactor: 0.016, // Z 深度转缩放的系数
    minimumDepthScale: -0.045, // 深度缩放下限
    maximumDepthScale: 0.08, // 深度缩放上限
    crossAxisExpansion: 0.55, // 压缩时垂直方向的膨胀比例
    rotationVelocityFactor: 0.18, // 速度转旋转的系数
    maximumRotation: 4.5, // 旋转上限（度）
    raisedDepth: 0.8, // 超过该深度就抬升层级
    raisedLayer: 12, // 抬升后的 z-index
  },

  // ═══════════ 波纹：点击 / 拖拽 / 归位落定的扰动 ═══════════
  wave: {
    frontSpeed: 0.48, // 波前扩散速度（px/ms，会再乘波纹的范围倍数）
    maximumRadius: 300, // 默认影响半径（Donate 用 rippleRangeScale 放大）
    minimumDistance: 10, // 距离下限，避免除以 0
    falloffExponent: 1.15, // 力度随距离衰减的指数
    depthImpulse: 1.32, // 波纹带来的 Z 轴冲量
    radialImpulse: 0.035, // 波纹带来的径向冲量
    motionCooldown: 230, // 被波纹推动后的运动冷却
    lifetime: 760, // 波纹存活时长
    radiusTail: 45, // 波前超出影响半径这么多后立即销毁
    baseStrength: 3.4, // 力度基准
    speedStrength: 0.3, // 速度对力度的加成
    maximumSpeedBonus: 9, // 速度加成的上限
    visualBaseForce: 0.82, // 可见波纹的力度基准（影响起始尺寸与亮度）
    visualSpeedForce: 0.018, // 可见波纹的速度加成
    visualMinimumForce: 0.7, // 可见波纹力度下限
    visualMaximumForce: 1.45, // 可见波纹力度上限
    minimumInterval: 90, // 可见波纹之间的最小间隔（刻意释放的大波纹可跳过）
    elementLifetime: 820, // 波纹 DOM 的兜底移除时间
    idleClickSpeed: 2, // 空白处点击折算的等效速度
    dragStartSpeed: 2, // 开始拖拽折算的等效速度
    returnSpeed: 3, // 归位落定折算的等效速度
  },

  // ═══════════ 碰撞：标签挤压、反弹与惯性传播 ═══════════
  collision: {
    spacing: 2, // 判定碰撞时额外计入的间隙
    returningDistance: 0.8, // 偏移超过该值视为"正在归位"，跳过碰撞
    activeDistance: 1, // 判定"有运动"的偏移阈值
    activeSpeed: 0.15, // 判定"有运动"的速度阈值
    pushFactor: 0.62, // 分离推力系数
    maximumPush: 12, // 单帧最大分离推力
    bounceFactor: 0.58, // 反弹系数
    velocityTransfer: 0.24, // 分离时传递给他者的速度比例
    impactFactor: 0.012, // 撞击压缩量的换算系数
    minimumImpact: 0.025, // 撞击压缩量下限
    maximumImpact: 0.18, // 撞击压缩量上限
    baseInertia: 420, // 惯性时长基准
    speedInertia: 34, // 接近速度对惯性时长的加成
    impactInertia: 900, // 撞击强度对惯性时长的加成
    minimumInertia: 480, // 惯性时长下限
    maximumInertia: 1050, // 惯性时长上限
  },

  // ═══════════ 视口边界：贴边与反弹 ═══════════
  bounds: {
    margin: 3, // 距视口边缘的留白
    restitution: 0.68, // 撞边反弹系数
    compression: 0.11, // 撞边时的压缩量
  },

  // ═══════════ 拖拽：跟随、拉伸与松手惯性 ═══════════
  drag: {
    basePull: 0.065, // 跟随指针的基础拉力
    distanceForMaximumPull: 420, // 达到最大拉力的距离
    maximumPullBonus: 0.13, // 距离越远额外增加的拉力
    damping: 0.79, // 拖动过程中的速度阻尼
    compressionFactor: 0.0014, // 拉伸距离转压缩的系数
    minimumCompression: 0.025, // 拖动压缩下限
    maximumCompression: 0.16, // 拖动压缩上限
    pointerMinimumElapsed: 8, // 计算指针速度的最小时间窗
    impulseBase: 0.012, // 位移冲量基准
    impulseDistance: 2200, // 位移冲量的归一化距离
    maximumImpulseBonus: 0.045, // 位移冲量上限加成
    speedCompressionFactor: 0.018, // 指针速度转压缩的系数
    speedCompressionMinimum: 0.03, // 速度压缩下限
    speedCompressionMaximum: 0.17, // 速度压缩上限
    mouseThreshold: 5, // 鼠标判定为拖拽的位移阈值
    touchThreshold: 8, // 触摸判定为拖拽的位移阈值
    initialCompression: 0.045, // 按下瞬间的压缩
    releasePull: 0.04, // 松手时朝目标的补偿拉力
    releaseVelocityRetention: 0.62, // 松手后保留的速度比例
    clickSuppressionDuration: 900, // 拖拽后抑制点击的时长
    doubleTapInterval: 340, // 判定"双击"的最大间隔（触屏上不要依赖 DOM 的 dblclick）
    doubleTapDistance: 28, // 两次轻点之间允许的位移（px），超出就不算同一处的双击
  },

  // ═══════════ 归位：弹簧回中、落定判定与落定波纹 ═══════════
  return: {
    idleDistance: 0.08, // 判定"已静止"的偏移阈值
    idleSpeed: 0.04, // 判定"已静止"的速度阈值
    boostDuration: 900, // 归位弹簧增益达到上限所需时间
    maximumBoost: 1.15, // 弹簧增益上限（离得越久回得越急）
    spring: 0.07, // 弹簧刚度
    damping: 0.76, // 弹簧阻尼
    crossingDistance: 0.7, // 判定"越过原点"的距离
    settleDistance: 1.15, // 判定归位完成的距离
    primeLookahead: 100, // 预测最近接点的提前量（ms）
    primeVelocityEpsilon: 0.0001, // 预测所需的最小速度，避免除零
    impactCompression: 0.14, // 落定撞击的压缩量
    collisionLift: 0.78, // 被撞后落定时的 Z 轴抬升
    collisionLiftCompression: 0.075, // 被撞后落定时的压缩量
    impactClassDuration: 460, // is-impacting 类的持续时间
    inertiaDamping: 0.965, // 惯性阶段的速度阻尼
  },

  // ═══════════ 深度与压缩的恢复 ═══════════
  depth: {
    spring: 0.085, // Z 轴弹簧刚度
    damping: 0.86, // Z 轴阻尼
    snapPosition: 0.015, // Z 归零的位置阈值
    snapVelocity: 0.012, // Z 归零的速度阈值
  },
  compression: {
    damping: 0.86, // 压缩量恢复阻尼
  },

  // ═══════════ 视觉：透视、层级、描边、波纹与急停动画 ═══════════
  visual: {
    perspective: '1100px', // #app 的透视距离
    activeLayer: 50, // 拖拽 / 被撞时的 z-index
    outlineInset: '-5px', // 拖动描边的外扩量
    rippleSize: '34px', // 可见波纹的基准直径
    rippleDuration: '780ms', // 可见波纹时长
    rippleEndScale: 4.8, // 可见波纹终点缩放（会再乘范围倍数）
    impactDuration: '440ms', // soft-impact 急停动画时长
    pickupDuration: '280ms', // soft-pickup 拿起动画时长
  },
}

export default physics
