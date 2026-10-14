# 配置说明

页面里所有适合调节的内容、动画和物理参数都在本目录，**每条参数的解释就写在参数后面的 `//` 注里**，这里只放跨文件、看不出来的约定。

配置是 `.ts` 模块（不是 `.json`）：这样既能写注释，又还能被 `vue-tsc` 类型检查；改完保存 Vite 会自动热更新。导入时写 `./configs/xxx`（不带扩展名）。

| 文件 | 管什么 |
| --- | --- |
| `site.ts` | 背景图、标签标题、一言开关与接口、页脚版权与备案、右下角背景出处 |
| `author.ts` | 名字、头像、链接行（顺序即显示顺序）；带 `action: 'donate'` 的条目走 Donate 展开 |
| `identity.ts` | bio 逐词 token、哪几段拼成名字、无障碍整句 |
| `animation.ts` | 入场 / 身份 / 一言 / Donate 的时序与曲线 |
| `physics.ts` | 拖拽、惯性、碰撞、归位、波纹扰动与每帧视觉变形 |
| `ui.ts` | 主题切换按钮、头像上方的归位计时器 |
| `donate.ts` | 右侧 Donate 内容块的文案、渠道与二维码 |

## 容易踩的几处

- **identity 的拼凑关系**：`bioTokens[].extractId` 与 `assembly.parts[].sourceId` 必须一一对应；`kind: 'name'` 的 token 是名字占位，`{name}` 会替换成 `author.ts` 的 `name`。想改成两段拼合，就保留两个带 `extractId` 的 token 和对应的两个 part。
- **单位**：`animation.ts` 里时长是毫秒、模糊与位移是像素、间距是 rem；`offset` 是 Web Animations 的 `0~1` 进度。`physics.ts` 里的距离是像素，速度/冲量是"每帧"的无量纲量（delta 以名义帧 16.67ms 为 1）。
- **波纹与碰撞的分工**：波纹位移是纯视觉的，不会获得"碰撞传播"资格；只有真实拖动、惯性或元素间撞击才会触发连续的标签碰撞。
- **触屏拖拽的保命措施**（手机上"拖到一半断掉"基本都出在这几条，且**必须覆盖所有可拖拽组件**——本项目有两条拖拽路径：`PhysicsItem`（头像/链接/主题按钮/内容块）与 `DragWord`（bio 词、一言 token），漏一个那个元素就继续断）：① 物理条目带 `touch-action: none` + `-webkit-touch-callout: none` 且禁掉 `contextmenu`——否则长按会弹「存储图像 / 在新标签页打开 / 划词」，浏览器顺手发一个 `pointercancel`，拖拽当场结束；② 不用 `lostpointercapture` 结束拖拽（iOS 上它可能在中途冒出来），统一只认 `pointerup` / `pointercancel`；③ `setPointerCapture` / `releasePointerCapture` 都包了 try/catch，捕获失败就退化成"不捕获"，靠 window 上的 `pointermove` 继续跟手；④ 拖到一半切后台 / 失焦时，`blur` 与 `visibilitychange` 会主动收尾（`finishDrag`），避免指针事件永远不来、拖拽卡在半路。为了不再"改了 A 忘了 B"：`touch-action` / `user-select` / callout / tap-highlight 这些已写进 `main.css` 的 `.soft-physics-item`，`contextmenu` 守卫也放进了 `useSoftPhysics` 的全局监听里（组件不写也安全）。
- **Donate 的触发**：`author.ts` 里带 `action: 'donate'`（或名为 `Donate`）的条目才会展开内容块，图标沿用那条链接的 `icon`，不用在 `donate.ts` 里重复配；`donate.ts` 的 `enable: false` 会让它变回普通链接。
- **Donate 的手感怎么调**：`animation.ts` 的 `donate` 段里，`flightDuration` 越小越"急"，`flightEasing` 起点越平（第一个控制点 y 越小）加速越猛、终点越陡则到中心时残留速度越多；`panelLead` 决定内容块与按钮重叠多少（=0 就退回"按钮先到、块再长"）。内容块的位移与缩放都挂在同一根阻尼弹簧上（`composables/dampedSpring.ts`）：`panelSpring.damping`（阻尼系数 ζ）越小过冲越大、来回越多，`panelSpring.frequency` 越大弹得越快，`panelSpring.settleEpsilon` 决定振幅衰减到起始的多少倍就收尾并**一步到位**到目标（所以没有"第几次过冲"这类参数）；`panelTravel*` 是位移通道的尺度与初速（`panelTravelLaunch` 直接乘按钮的到达速度，即速度继承），`panelScaleLaunch` 是缩放通道的初速。调完想确认结果不用开浏览器：写个临时 `.mjs` 让 Node 直接 import `dampedSpring.ts` 和 `animation.ts`，打印各通道峰值与收尾时长即可。收起走另一根 `closeSpring`（同样由 ζ/频率/阈值决定）：块与按钮**共用**它，`closeFollowRatio` 是块跟随按钮的行程比例（同一根弹簧按比例缩放，所以初期两者完全同步地往回缩、往回飞），`closeFadeOffset` 决定块在多早淡出，按钮则按同一根弹簧过冲过落点再弹回（ζ=0.62 时约冲出回程距离的 8%）。右侧板块指侧栏之右的整块区域，窄屏（宽度小于 `minimumRightRegion`）时改用视口中心。
- **渠道列表 ⇄ 收款码**：列表每行只显示图标 / 名称 / 说明（右侧不再摆二维码），点某一行走 `animation.ts` 的 `donate.channelSwitch`——列表淡出、收款码淡入；点收款码视图任意处淡回列表。收款码态会放宽面板高度上限（`.donate-panel.is-qr { max-height: min(92vh, 44rem) }`）并把码框放大到 `min(15rem, 62vw)`；两个视图高度不同时用 `channelSwitch.resizeDuration` 动画 `height`，把尺寸变化也做顺。二维码路径写在 `donate.ts` 的 `channels[].qr`，**必须是 `/` 开头的根路径**（`public/` 目录会被 Vite 映射到站点根，写 `public/donate-wechat.png` 在 dev 能加载、生产构建后 404）；留空或图片加载失败都会退化成虚线占位框。
- **右侧板块同一时刻只给一个块用**：`composables/blockStage.ts` 提供 `RIGHT_STAGE_EVENT` 与 `claimRightStage(owner)`；Donate 打开时 claim，收到别人的 claim 时把自己收起。所以**点面板外面不会收回 Donate**，收起只有三条路：✕ 按钮、Esc、别的块要占用右侧中心。以后新增占用该区域的块，照这个协议接（打开时 claim + 监听别人的 claim 让位）。
- **双击头像 = 一键归位**：**不是瞬移坐标**，而是 `useSoftPhysics.settleSoftPhysics()` 把全体（拖拽中的除外）元素切进"归位模式"——放开归位冷却并预支归位弹簧的增益（`ui.ts` 的 `stabilize.returnBoost`，越大回得越急），让它们各自被弹簧拉回原点；期间与落定后按 `stabilize.collisionCooldown` 设定碰撞冷却（实现上是给元素挂一个"落定冷却覆盖值"，落定后清空并回到各预设值）。**归位落定那圈波纹带 `respectImmunity: true`**，所以免疫窗口内的邻居不会被这圈波纹推走（否则刚归位就被推散、又被判成"要归位"）；点空白/拖拽产生的波纹不受此限制，照旧推动一切。`stabilize.clearWaves` 决定是否顺手清掉正在扩散的波纹，`stabilize.settleRipple` 决定没被拖拽过（纯被崩飞/吹动）的元素落定时是否也出波纹。头像宿主上挂了原生 `title` 提示。**双击是在指针层自己认的**（`physics.ts` 的 `drag.doubleTapInterval` 340ms + `drag.doubleTapDistance` 28px：两次轻点都没被判成拖拽、落点也没跑远才算），不用 DOM 的 `dblclick`——触屏上它会被双击缩放手势或手指微动吃掉，`PhysicsItem` 识别到后会抛 `double-tap` 事件给页面（`useSoftPhysics` 的 `onDoubleTap`）。
- **计时器超时提示**：`ui.ts` 的 `returnTimer.hint` 一组管它——`after`（默认 10s）之后，计时文字与 `hint.label`（"双击头像快速归位"）按 `interval`（2s）交替，每次 `fadeDuration`（0.3s）淡入淡出；两层绝对叠放做交叉淡入，宽度不会跟着跳。
- **主题色过渡**：`ui.ts` 的 `transitionDuration` / `transitionEasing` 会被写成 CSS 变量，页面各处（侧栏、页脚、图标）都跟着它走。
- **内容块本身是物理条目**：可拖动、有碰撞箱（质量等沿用 `physics.ts` 的 `container` 预设），拖动后同样会归位并在落点触发归位波纹。物理位移写在宿主 `.donate-panel-host` 的 `--physics-*` 上，弹出弹簧写在内层 `.donate-panel` 上，两者互不干扰；内容块也是唯一不参与"崩飞隐形"的物理条目（CSS 用 `:not(.donate-panel-host)` 排除）。它带了 `drag-ignore-selector="a, button"`（从内部按钮/链接上按下时不发起拖拽）和 `:highlight="false"`（不显示拖拽描边与高亮），这两个开关是 `PhysicsItem` 的通用属性。
- **窄屏崩飞**：`animation.ts` 的 `donate.scatter` 只在 `<768px`（侧栏占满全屏）时生效——内容块弹开瞬间把全场元素切进"自由场"（`setSoftPhysicsFree(true)`，不再归位），并由块自己发出一圈大范围冲击波把它们崩飞（源是自己，所以块不会被推走），`delay` 之后一起隐形（`fadeOutDuration` 慢淡出）、留在原地不回位，直到收起时才复现（`fadeInDuration` 快淡入）并重新归位。注意引擎的波纹默认以 Z 轴冲量为主（`depthImpulse 1.32` ≫ `radialImpulse 0.035`），要"横向崩飞"必须调大 `radialScale` 并把 `depthScale` 压小。
- **块的毛玻璃**：内容块的背景 / 描边 / 模糊直接复用左侧栏那套类名（`bg-white/50 border-white/50 dark:bg-black/60 dark:border-gray-700/50 backdrop-blur-2xl`），改一处两边一起变。注意宿主 `.donate-panel-host` 必须 `transform-style: flat`——物理条目默认的 `preserve-3d` 会让子元素的 `backdrop-filter` 完全失效，看起来就是"背景全透明"；同理，拖拽时那条 `filter: brightness(...)` 高亮也会破坏毛玻璃，所以块用了 `physics-item--plain` 把 filter 清掉。
- **拒绝滚动**：整页是 `html` / `body` 双 `overflow: hidden` + `overscroll-behavior: none`，再加 `#app { overflow: hidden }` —— 最后这条很关键：被 transform 崩出视口的元素会撑大"可滚动区域"，一旦被撑大，移动端就能把整个页面拖走，裁掉之后飞出去的元素直接在边界处消失。Donate 内容块内部也是 `overflow: hidden`（不产生滚动区域、不出现滚动条，内容超高时裁掉）。
