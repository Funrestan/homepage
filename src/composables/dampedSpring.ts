/**
 * 阻尼弹簧：把"第一次过冲、第二次过冲"这类手写关键帧，换成由阻尼系数与固有频率解析算出来的曲线。
 *
 * 位移、缩放都能挂在同一根弹簧上（各自给起始偏离与初速即可），这样两者天然同步；
 * 振幅包络衰减到起始的 settleEpsilon 倍以内就收尾，末帧直接落在目标上（一步到位），
 * 剩下的抖动肉眼已经看不出来，不必再采样。
 *
 * 欠阻尼解析解：u(t) = e^(-ζωt)·[u0·cos(ω_d t) + ((v0 + ζω·u0)/ω_d)·sin(ω_d t)]
 * 其中 ω = 2πf、ω_d = ω√(1-ζ²)，u 是相对目标的偏移，v0 为正表示朝目标方向初速。
 */

export type DampedSpringChannel = {
  /** 起始偏离目标的值（动画第 0 帧出现的位置，负值 = 在目标反方向一侧） */
  offset: number
  /** 起始速度（单位/秒，正 = 朝目标）；它才是"速度继承"真正落到曲线上的地方 */
  velocity: number
}

export type DampedSpringOptions = {
  /** 阻尼系数 ζ：<1 欠阻尼（有过冲，越小弹得越多、来回越久），≥1 不过冲 */
  damping: number
  /** 固有频率（Hz）：越大弹得越快 */
  frequency: number
  /** 剩余振幅包络衰减到起始的该比例以内就收尾 */
  settleEpsilon: number
  /** 采样步长（ms），越小越贴近解析曲线 */
  sampleStep: number
  /** 兜底最长时长（ms） */
  maximumDuration: number
}

export type DampedSpringTrack = {
  /** 采样时间（ms），首帧 0，末帧 = settleTime */
  times: number[]
  /** 与 times 一一对应的各通道偏移；末帧全部为 0 */
  values: Record<string, number[]>
  /** 收尾时刻（ms） */
  settleTime: number
}

type Evaluator = {
  valueAt: (seconds: number) => number
  settleTime: (epsilon: number) => number
}

const NEARLY_NONE = 1e-6

const makeEvaluator = (
  channel: DampedSpringChannel,
  damping: number,
  frequency: number,
): Evaluator => {
  const omega = 2 * Math.PI * Math.max(0.01, frequency)
  const zeta = Math.min(0.995, Math.max(0.02, damping))
  const offset = Number.isFinite(channel.offset) ? channel.offset : 0
  const velocity = Number.isFinite(channel.velocity) ? channel.velocity : 0

  // 临界/过阻尼：不振荡，u(t) = e^(-ωt)·(u0 + (v0 + ω·u0)·t)
  if (zeta >= 0.995) {
    const slope = velocity + omega * offset
    const amplitude = Math.max(Math.abs(offset), Math.abs(slope) / omega)
    return {
      valueAt: (seconds) => Math.exp(-omega * seconds) * (offset + slope * seconds),
      settleTime: (epsilon) => {
        if (amplitude < NEARLY_NONE) return 0
        const limit = epsilon * amplitude
        for (let seconds = 0; seconds * 1000 < 4000; seconds += 0.005) {
          if (Math.abs(Math.exp(-omega * seconds) * (offset + slope * seconds)) <= limit) {
            return seconds
          }
        }
        return 4
      },
    }
  }

  const rho = Math.sqrt(1 - zeta * zeta)
  const omegaD = omega * rho
  const a = offset
  const b = (velocity + zeta * omega * offset) / omegaD
  const amplitude = Math.hypot(a, b)

  return {
    valueAt: (seconds) => Math.exp(-zeta * omega * seconds)
      * (a * Math.cos(omegaD * seconds) + b * Math.sin(omegaD * seconds)),
    // 包络 = amplitude·e^(-ζωt)，直接解出衰减到 epsilon 倍所需的时间
    settleTime: (epsilon) => (amplitude < NEARLY_NONE ? 0 : Math.log(1 / epsilon) / (zeta * omega)),
  }
}

export const sampleDampedSpring = (
  channels: Record<string, DampedSpringChannel>,
  options: DampedSpringOptions,
): DampedSpringTrack => {
  const names = Object.keys(channels)
  const epsilon = Math.min(0.5, Math.max(0.0001, options.settleEpsilon))
  const maximumSeconds = Math.max(0.08, options.maximumDuration / 1000)
  const evaluators = names.map((name) => makeEvaluator(
    channels[name] ?? { offset: 0, velocity: 0 },
    options.damping,
    options.frequency,
  ))

  const settleSeconds = Math.min(
    maximumSeconds,
    Math.max(0, ...evaluators.map((evaluator) => evaluator.settleTime(epsilon))),
  )
  const settleTime = Math.max(80, settleSeconds * 1000)
  const step = Math.max(4, options.sampleStep)

  const times: number[] = []
  for (let time = 0; time < settleTime; time += step) times.push(time)
  times.push(settleTime)

  const values: Record<string, number[]> = {}
  names.forEach((name, index) => {
    const evaluator = evaluators[index]
    values[name] = times.map((time, frame) => (
      frame === times.length - 1 || !evaluator ? 0 : evaluator.valueAt(time / 1000)
    ))
  })

  return { times, values, settleTime }
}
