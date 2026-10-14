/**
 * 身份区（bio 逐词 → 拼出名字）的文案与 token 编排。
 * 想改成别的自我介绍：改 bioTokens（逐词 + 标点）与 assembly.parts（哪几段拼成名字）即可。
 */

/** 拼凑片段：把 bio 中的某个 token 抽出来，按顺序合成名字 */
type AssemblyPartConfig = {
  id: string // 片段自身 id
  sourceId: string // 对应 bioTokens[].extractId，指明这段从哪个词抽出来
  text: string // 片段文字（最终会小写化）
  floatDelay: number // 浮动相位延迟（负值错开，避免整排同步晃）
}

/** bio 的逐词 token */
type BioTokenConfig = {
  id: string // 唯一 id
  text: string // 显示文字；`{name}` 会替换成 author.name
  floatDelay: number // 浮动相位延迟
  extractId?: string // 标记该词是拼凑来源，值要与 assembly.parts[].sourceId 对应
  tightLeft?: boolean // 逗号等需要紧贴前一个词的标点
  kind?: 'name' // 名称占位 token：名字回填阶段才显示
}

const identity = {
  accessibleBio: "Have your fun, get your rest, be an original — that's {name}.", // 屏幕阅读器用的完整句子；{name} 会替换成 author.ts 的 name

  // —— 名字（占位 token 与解析完成后的浮动相位）——
  name: {
    placedFloatDelay: -1.6, // 名字落位后的浮动相位延迟
    resolvedFloatDelay: -1, // 名字解析完成后的浮动相位延迟
  },

  // —— 拼凑：哪几段从 bio 里抽出来合成名字 ——
  assembly: {
    parts: [
      { id: 'fun', sourceId: 'fun', text: 'fun', floatDelay: -0.5 },
      { id: 'rest', sourceId: 'rest', text: 'rest', floatDelay: -1.3 },
      { id: 'an', sourceId: 'an', text: 'an', floatDelay: -2.1 },
    ] as AssemblyPartConfig[], // 增删片段即可改变名字的拼法（sourceId 必须存在对应的 extractId）
  },

  // —— bio 逐词：每个词一个可拖拽 token ——
  bioTokens: [
    { id: 'have', text: 'Have', floatDelay: -0.2 },
    { id: 'your-1', text: 'your', floatDelay: -1.1 },
    { id: 'fun', text: 'fun', floatDelay: -2.3, extractId: 'fun' }, // 被抽走拼名字
    { id: 'comma-1', text: ',', floatDelay: -0.5, tightLeft: true }, // 标点紧贴前词
    { id: 'get', text: 'get', floatDelay: -0.7 },
    { id: 'your-2', text: 'your', floatDelay: -1.8 },
    { id: 'rest', text: 'rest', floatDelay: -2.8, extractId: 'rest' },
    { id: 'comma-2', text: ',', floatDelay: -1.2, tightLeft: true },
    { id: 'be', text: 'be', floatDelay: -0.4 },
    { id: 'an', text: 'an', floatDelay: -2.1, extractId: 'an' },
    { id: 'original', text: 'original', floatDelay: -1.4 },
    { id: 'dash', text: '—', floatDelay: -0.9 },
    { id: 'thats', text: "that's", floatDelay: -1.9 },
    { id: 'resolved-name', text: '{name}.', floatDelay: -2.6, kind: 'name' }, // 名称占位
  ] as BioTokenConfig[],
}

export default identity
