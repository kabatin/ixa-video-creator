import type { DubChunk } from '@ixa/domain'
import { measureLoudness, type LoudnessMeasurement } from '../audio.js'
import { FfmpegError, runFfmpeg, type RunOptions } from '../ffmpeg-runner.js'
import { loudnormLinearFilter, loudnormMeasureFilter, parseLoudnormJson } from '../program-loudness.js'

/**
 * 声を差し替えた動画を作る（ADR-0062）。
 *
 * 1. 元の音は、元の声を消す範囲だけ 0 にする（`volume=if(between…)`。物音・環境音は範囲の外に残る）
 * 2. 置く声を `adelay` で置き、`amix normalize=0 duration=first`（長さは元の音のまま）
 * 3. loudnorm 2 パス（-16 LUFS・TP -1.5・LRA 11・linear。全体に同じ倍率）
 * 4. 映像は写すだけ（copy）、音は AAC 192k
 */

export const DUB_TARGET_LUFS = -16
const AUDIO_BITRATE = '192k'
/** 消す式を見る音の刻み（1ms。volume は区切りごとに式を見るので、細かくしないと戻りが段になる）。 */
const MUTE_STEP_SAMPLES = 48
/** 消す範囲の外側で、0 から 1 へ戻す長さ（ぷつっと切れる音を出さない）。 */
export const DUB_MUTE_RAMP_SEC = 0.015
const MIX_FORMAT = 'aformat=sample_rates=48000:channel_layouts=stereo'
/** 声（モノラル）を左右に同じ大きさで写す（音量合わせの基準の左右の平均と同じ大きさになる）。 */
const VOICE_TO_STEREO = 'aformat=channel_layouts=mono,pan=stereo|c0=c0|c1=c0'

export type DubVoice = {
  readonly path: string
  /** 置く時刻（動画の頭からの秒）。 */
  readonly startSec: number
  /** 掛ける dB（音量合わせ + 距離）。 */
  readonly gainDb: number
}

export type MixDubInput = {
  readonly videoPath: string
  readonly voices: readonly DubVoice[]
  readonly muteRanges: readonly DubChunk[]
}

const fmt = (sec: number): string => sec.toFixed(4)

/** 1 つの範囲の消し具合（範囲の中は 1、外側 15ms で 0 へ）。 */
const attenuation = (range: DubChunk): string =>
  `clip(min(t-${fmt(range.startSec - DUB_MUTE_RAMP_SEC)},${fmt(range.endSec + DUB_MUTE_RAMP_SEC)}-t)/${fmt(DUB_MUTE_RAMP_SEC)},0,1)`

/** 範囲の中だけ 0 にし、範囲の外側 15ms で元の大きさへ戻す式。範囲が無ければ元の音のまま。 */
export const muteExpression = (ranges: readonly DubChunk[]): string => {
  if (ranges.length === 0) return '1'
  const nested = ranges
    .map(attenuation)
    .reduceRight((inner, outer) => (inner === '' ? outer : `max(${outer},${inner})`), '')
  return `1-${nested}`
}

/** 混ぜるまでの filter_complex（最後のラベルは `[mix]`）。 */
export const dubMixGraph = (input: MixDubInput): string => {
  const original = `[0:a]${MIX_FORMAT},asetnsamples=n=${MUTE_STEP_SAMPLES}:p=0,volume='${muteExpression(input.muteRanges)}':eval=frame[orig]`
  const voices = input.voices.map((voice, index) => {
    const delayMs = Math.max(0, Math.round(voice.startSec * 1000))
    return `[${index + 1}:a]${VOICE_TO_STEREO},${MIX_FORMAT},volume=${voice.gainDb.toFixed(3)}dB,adelay=${delayMs}:all=1[v${index}]`
  })
  const labels = ['[orig]', ...input.voices.map((_, index) => `[v${index}]`)].join('')
  return [original, ...voices, `${labels}amix=inputs=${input.voices.length + 1}:normalize=0:duration=first[mix]`].join(';')
}

const inputsOf = (input: MixDubInput): readonly string[] => ['-i', input.videoPath, ...input.voices.flatMap((voice) => ['-i', voice.path])]

/** 1 回目（混ぜて測る）。 */
export const mixDubMeasureArgs = (input: MixDubInput): readonly string[] => [
  '-hide_banner', '-nostats', ...inputsOf(input),
  '-filter_complex', `${dubMixGraph(input)};[mix]${loudnormMeasureFilter(DUB_TARGET_LUFS)}[out]`,
  '-map', '[out]', '-f', 'null', '-',
]

/** 2 回目（混ぜて、測った値で線形に直して書く）。 */
export const mixDubWriteArgs = (
  input: MixDubInput,
  outputPath: string,
  measured: NonNullable<ReturnType<typeof parseLoudnormJson>>,
): readonly string[] => [
  '-y', ...inputsOf(input),
  '-filter_complex', `${dubMixGraph(input)};[mix]${loudnormLinearFilter(DUB_TARGET_LUFS, measured)},aresample=48000[out]`,
  '-map', '0:v?', '-map', '[out]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', AUDIO_BITRATE, '-movflags', '+faststart', outputPath,
]

/** 混ぜて書き、書いた後の大きさを返す。混ぜた音が無音で測れなければ失敗にする（黙って元のまま使わない）。 */
export const mixDub = async (input: MixDubInput, outputPath: string, options?: RunOptions): Promise<LoudnessMeasurement> => {
  const measureArgs = mixDubMeasureArgs(input)
  const { stderr } = await runFfmpeg(measureArgs, options)
  const measured = parseLoudnormJson(stderr)
  if (measured === null) {
    throw new FfmpegError('声を差し替えた音の大きさを測れませんでした（無音の可能性があります）', `ffmpeg ${measureArgs.join(' ')}`, 0, stderr)
  }
  await runFfmpeg(mixDubWriteArgs(input, outputPath, measured), options)
  return measureLoudness(outputPath)
}
