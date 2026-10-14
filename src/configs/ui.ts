/**
 * 界面元素：主题切换按钮、头像上方的归位计时器。
 */
const ui = {
  // ═══════════ 亮/暗主题按钮（链接行最后一个） ═══════════
  themeToggle: {
    enable: true, // 是否显示该按钮
    lightIcon: 'mingcute:sun-line', // 亮色主题图标（Iconify 名称）
    darkIcon: 'mingcute:moon-line', // 暗色主题图标
    lightTooltip: 'Light', // 切到亮色时的悬浮提示
    darkTooltip: 'Dark', // 切到暗色时的悬浮提示
    transitionDuration: 520, // 主题色、图标旋转等过渡时长
    backgroundFadeDuration: 850, // 背景图交叉淡入时长
    transitionEasing: 'cubic-bezier(0.22, 0.72, 0.22, 1)', // 主题过渡缓动
  },

  // ═══════════ 归位计时器（出现在头像上方，拖拽后开始计时） ═══════════
  returnTimer: {
    enable: true, // 是否显示
    runningLabel: 'Returning', // 归位中的文案
    completeLabel: 'Return time', // 归位完成的文案
    unit: 's', // 时间单位文案
    precision: 3, // 小数位（3 = 0.001 s）
    displayDuration: 2000, // 完成后保留多久
    fadeDuration: 240, // 消散（淡出 + 模糊）时长
    completionRippleSpeed: 3, // 完成时那圈波纹的力度（折算成速度）
    offsetTop: '-2.15rem', // 相对头像顶部的偏移
    minimumWidth: '9.5rem', // 最小宽度，避免数字跳动时宽度抖动

    // 计时太久就交替提示"怎么一键收拾"（提示的正是双击头像）
    hint: {
      label: '双击头像快速归位', // 与计时文字交替显示的提示文案
      after: 2000, // 计时超过这个毫秒数（10s）开始交替
      interval: 2000, // 交替间隔（每 2s 换一次）
      fadeDuration: 300, // 每次交替的淡入淡出时长
    },
  },

  // ═══════════ 双击头像：让全体元素进入"归位模式"（弹簧拉回，不是瞬移坐标） ═══════════
  stabilize: {
    returnBoost: 1035, // 归位弹簧增益的预热量：越大回得越急（≈ physics.return.boostDuration × maximumBoost 时吃满增益）
    collisionCooldown: 620, // 归位期间 + 落定后的碰撞冷却：这段时间内元素之间不再互相碰撞、也不被波纹推动（避免刚归位又被推散）
    settleRipple: true, // 落定时是否出波纹（被崩飞/吹动过、没被拖拽过的元素也出）
    clearWaves: true, // 归位瞬间清掉正在扩散的波纹，免得刚拉回又被推走
  },
}

export default ui
