import type { DubChunk } from '@ixa/domain'
import { runFfmpeg } from '../ffmpeg-runner.js'

/**
 * 読み上げを区切って伸縮する（ADR-0062）。切り出した所をつなぎ（つなぎ目は 8ms でフェード）、
 * 全体に一定の倍率の atempo を掛ける。必要なら最後を切ってフェードする。
 */

/** つなぎ目のフェード。 */
export const DUB_JOIN_FADE_SEC = 0.008
/** atempo が 1 段で受ける倍率の幅。外れたら段を重ねる。 */
const ATEMPO_MIN = 0.5
const ATEMPO_MAX = 2
/** 書き出す音（混ぜる側に合わせる）。 */
const OUTPUT_RATE = '48000'

const fmt = (sec: number): string => sec.toFixed(4)

/** 倍率を atempo の段に分ける（1 段は 0.5〜2.0）。 */
export const atempoChain = (tempo: number): readonly number[] => {
  if (!(tempo > 0) || !Number.isFinite(tempo)) throw new Error(`伸縮の倍率が正しくありません（${String(tempo)}）`)
  const steps = (rest: number, acc: readonly number[]): readonly number[] => {
    if (rest > ATEMPO_MAX) return steps(rest / ATEMPO_MAX, [...acc, ATEMPO_MAX])
    if (rest < ATEMPO_MIN) return steps(rest / ATEMPO_MIN, [...acc, ATEMPO_MIN])
    return [...acc, rest]
  }
  return steps(tempo, [])
}

export type StretchPlan = {
  /** 読み上げから切り出す所（読み上げの時刻）。 */
  readonly pieces: readonly DubChunk[]
  readonly tempo: number
  /** 伸縮の後に切る長さと最後のフェード（無ければ切らない）。 */
  readonly cut?: { readonly durationSec: number; readonly fadeOutSec: number } | undefined
}

const pieceFilter = (piece: DubChunk, index: number): string => {
  const length = piece.endSec - piece.startSec
  const fade = Math.min(DUB_JOIN_FADE_SEC, length / 2)
  return (
    `[0:a]atrim=start=${fmt(piece.startSec)}:end=${fmt(piece.endSec)},asetpts=PTS-STARTPTS,` +
    `afade=t=in:d=${fmt(fade)},afade=t=out:st=${fmt(length - fade)}:d=${fmt(fade)}[p${index}]`
  )
}

const cutFilter = (cut: StretchPlan['cut']): string => {
  if (cut === undefined) return ''
  const fadeOut = cut.fadeOutSec > 0 ? `,afade=t=out:st=${fmt(Math.max(0, cut.durationSec - cut.fadeOutSec))}:d=${fmt(cut.fadeOutSec)}` : ''
  return `,atrim=duration=${fmt(cut.durationSec)}${fadeOut}`
}

export const stretchChunksArgs = (inputPath: string, outputPath: string, plan: StretchPlan): readonly string[] => {
  if (plan.pieces.length === 0) throw new Error('伸縮する読み上げの区間がありません')
  const labels = plan.pieces.map((_, index) => `[p${index}]`).join('')
  const tempo = atempoChain(plan.tempo).map((step) => `atempo=${step.toFixed(6)}`).join(',')
  const graph = [
    ...plan.pieces.map(pieceFilter),
    `${labels}concat=n=${plan.pieces.length}:v=0:a=1,${tempo}${cutFilter(plan.cut)}[out]`,
  ].join(';')
  return ['-y', '-i', inputPath, '-filter_complex', graph, '-map', '[out]', '-ac', '1', '-ar', OUTPUT_RATE, '-c:a', 'pcm_s16le', outputPath]
}

/** 伸縮した読み上げを WAV（48kHz・モノラル）で書く。 */
export const stretchChunks = async (inputPath: string, outputPath: string, plan: StretchPlan): Promise<void> => {
  await runFfmpeg(stretchChunksArgs(inputPath, outputPath, plan))
}
