# 配置说明

页面中适合调节的内容、动画和物理参数集中在本目录，修改 JSON 后 Vite 会自动刷新页面。

## `identity.json`

- `bioTokens`：bio 的可拖动 token。`text` 是显示文字，`floatDelay` 是兼容字段，`tightLeft` 用于逗号等紧贴前词的标点。
- `bioTokens[].extractId`：标记该 token 是拼凑来源。
- `assembly.parts`：定义拼凑片段、顺序和目标文字。`sourceId` 必须对应一个 `extractId`；可增删片段，不再限定为 `fun/rest/an` 三段。
- `kind: "name"`：该 token 在最终名称放置阶段出现；`{name}` 会替换为 `author.json` 中的名称。
- `accessibleBio`：供屏幕阅读器使用的完整文本，也支持 `{name}`。

示例：若要改为两段拼合，只需保留两个带 `extractId` 的 bio token，并让 `assembly.parts` 保留对应的两项。

## `animation.json`

- `entrance`：侧栏、头像发牌、bio/链接分发和页脚入场。
- `identity`：来源发光、复制、片段合并、小写到最终名称、名称回填。
- `hitokoto`：一言收发牌、临时文字层、颜色、透明度、模糊和容器显隐。

时间单位均为毫秒；模糊值为像素；`offset` 为 Web Animations 的 `0~1` 进度。

## `physics.json`

- `presets`：普通单词、头像、链接、一言 token 的质量、影响力、惯性冷却和归位碰撞冷却。
- `wave`：Z 轴波纹速度、范围、力度和可见波纹参数。
- `collision`：标签挤压、反弹、速度传递和惯性持续时间。
- `drag`：距离增力拖拽、触摸/鼠标阈值、松手惯性和点击抑制。
- `return`：快速归位、到位判定、源元素波纹及被撞元素自身 Z 轴回弹。
- `bounds`：视界边缘限制和反弹。
- `visual`：透视、层级、拖动描边、波纹和急停动画的基础尺寸/时长。

波纹位移本身不会获得碰撞传播标签；只有真实拖动、惯性或标签撞击会触发标签间碰撞。
