import type { ShotCamera } from '@ixa/domain'

/**
 * 1 枚の画像をどう動かすか（ADR-0025）。**Shot のカメラ指定に従う。**
 *
 * 指定が無ければ seed で選ぶ。同じ画像から作り直しても毎回違う Take になり、
 * checksum の重複判定（worker）で古い Take に化けない。
 */

export type MotionKind = 'push_in' | 'pull_out' | 'pan_left' | 'pan_right' | 'tilt_up' | 'tilt_down'

export type StillMotion = {
  readonly kind: MotionKind
  /** 動く量。拡大率の増分（0.1 = 10% 寄る / 画面の 10% 流れる）。 */
  readonly amount: number
}

const AMOUNT_BY_INTENSITY = { subtle: 0.06, moderate: 0.12, strong: 0.2 } as const

/** 固定でも止め絵のままにしない。気付かない程度に寄る。 */
const STATIC_AMOUNT = 0.03

const FREE_CHOICES: readonly MotionKind[] = ['push_in', 'pull_out', 'pan_left', 'pan_right']

const pick = <T>(choices: readonly T[], seed: number): T => choices[Math.abs(seed) % choices.length] as T

export const planStillMotion = (camera: ShotCamera, seed: number): StillMotion => {
  const amount =
    camera.movementIntensity === null
      ? 0.08 + (Math.abs(seed) % 5) * 0.01
      : AMOUNT_BY_INTENSITY[camera.movementIntensity]
  switch (camera.movement) {
    case 'static':
      return { kind: 'push_in', amount: STATIC_AMOUNT }
    case 'push_in':
    case 'pull_out':
      return { kind: camera.movement, amount }
    case 'tilt':
    case 'crane':
      return { kind: pick(['tilt_up', 'tilt_down'] as const, seed), amount }
    case 'pan':
    case 'tracking':
    case 'orbit':
    case 'handheld':
      return { kind: pick(['pan_left', 'pan_right'] as const, seed), amount }
    case null:
      return { kind: pick(FREE_CHOICES, seed), amount }
  }
}

export type MotionOutput = {
  readonly width: number
  readonly height: number
  readonly fps: number
  /** 作るコマ数（尺 × fps）。 */
  readonly frames: number
}

/**
 * 拡大してから動かす倍率。zoompan は位置を整数に丸めるので、そのままの大きさで動かすと
 * 1 画素ずつ跳ねて震えて見える。大きくしてから縮めると滑らかになる。
 */
const OVERSAMPLE = 2

/**
 * ffmpeg の `-filter_complex` に渡す 1 本の式。
 * 画面を埋めるように切り抜いてから（縦長でも黒帯を出さない）、`zoompan` で動かす。
 */
export const buildMotionFilter = (motion: StillMotion, output: MotionOutput): string => {
  const w = output.width * OVERSAMPLE
  const h = output.height * OVERSAMPLE
  const last = Math.max(output.frames - 1, 1)
  const t = `(on/${String(last)})`
  const a = motion.amount.toFixed(4)
  const centerX = 'iw/2-(iw/zoom/2)'
  const centerY = 'ih/2-(ih/zoom/2)'
  const { z, x, y } = ((): { z: string; x: string; y: string } => {
    switch (motion.kind) {
      case 'push_in':
        return { z: `1+${a}*${t}`, x: centerX, y: centerY }
      case 'pull_out':
        return { z: `1+${a}*(1-${t})`, x: centerX, y: centerY }
      case 'pan_right':
        return { z: `1+${a}`, x: `(iw-iw/zoom)*${t}`, y: centerY }
      case 'pan_left':
        return { z: `1+${a}`, x: `(iw-iw/zoom)*(1-${t})`, y: centerY }
      case 'tilt_down':
        return { z: `1+${a}`, x: centerX, y: `(ih-ih/zoom)*${t}` }
      case 'tilt_up':
        return { z: `1+${a}`, x: centerX, y: `(ih-ih/zoom)*(1-${t})` }
    }
  })()
  return [
    `scale=${String(w)}:${String(h)}:force_original_aspect_ratio=increase`,
    `crop=${String(w)}:${String(h)}`,
    `zoompan=z='${z}':x='${x}':y='${y}':d=${String(output.frames)}:s=${String(output.width)}x${String(output.height)}:fps=${String(output.fps)}`,
    'format=yuv420p',
  ].join(',')
}
