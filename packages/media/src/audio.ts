import { FfmpegError, runFfmpeg } from './ffmpeg-runner.js'

/** 音楽解析サービスへ渡す共通フォーマット。48kHz / モノラル / 16bit PCM。 */
const WAV_SAMPLE_RATE = '48000'
const WAV_CHANNELS = '1'
const WAV_CODEC = 'pcm_s16le'

export type LoudnessMeasurement = {
  /** ITU-R BS.1770 の統合ラウドネス（LUFS）。無音のときは -Infinity。 */
  integratedLufs: number
  /** トゥルーピーク（dBFS）。無音のときは -Infinity。 */
  truePeakDb: number
}

/** ffmpeg は無音のとき "-inf" を出力する。parseFloat では NaN になるため個別に扱う。 */
const parseDecibel = (raw: string): number | null => {
  const trimmed = raw.trim()
  if (/^-inf$/i.test(trimmed)) return Number.NEGATIVE_INFINITY
  const parsed = Number.parseFloat(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

const matchValue = (text: string, pattern: RegExp): number | null => {
  const match = pattern.exec(text)
  const captured = match?.[1]
  return captured === undefined ? null : parseDecibel(captured)
}

/**
 * `ebur128` フィルタが stderr へ出す Summary ブロックをパースする純粋関数。
 *
 * ```
 * [Parsed_ebur128_0 @ ...] Summary:
 *
 *   Integrated loudness:
 *     I:         -23.0 LUFS
 *   ...
 *   True peak:
 *     Peak:       -1.0 dBFS
 * ```
 * フィルタは計測中も逐次ログを吐くため、最後の Summary 以降だけを対象にする。
 */
export const parseEbur128Summary = (stderr: string): LoudnessMeasurement | null => {
  const summaryIndex = stderr.lastIndexOf('Summary:')
  if (summaryIndex === -1) return null

  const summary = stderr.slice(summaryIndex)
  const integratedLufs = matchValue(summary, /^\s*I:\s*(-?[\d.]+|-inf)\s*LUFS/im)
  const truePeakDb = matchValue(summary, /^\s*Peak:\s*(-?[\d.]+|-inf)\s*dBFS/im)

  if (integratedLufs === null || truePeakDb === null) return null
  return { integratedLufs, truePeakDb }
}

/** 音楽解析サービスへ渡すための WAV（48kHz モノラル）を書き出す。 */
export const extractAudio = async (inputPath: string, outputPath: string): Promise<void> => {
  await runFfmpeg([
    '-y',
    '-i',
    inputPath,
    '-vn',
    '-ac',
    WAV_CHANNELS,
    '-ar',
    WAV_SAMPLE_RATE,
    '-c:a',
    WAV_CODEC,
    outputPath,
  ])
}

/**
 * EBU R128 の統合ラウドネスとトゥルーピークを計測する。
 * 音声ストリームが無い素材では ffmpeg 側が失敗し FfmpegError になる。
 */
export const measureLoudness = async (inputPath: string): Promise<LoudnessMeasurement> => {
  const args = [
    '-hide_banner',
    '-nostats',
    '-i',
    inputPath,
    '-map',
    'a:0',
    '-af',
    'ebur128=peak=true',
    '-f',
    'null',
    '-',
  ]

  const { stderr } = await runFfmpeg(args)
  const measurement = parseEbur128Summary(stderr)

  if (measurement === null) {
    throw new FfmpegError(
      'ebur128 の Summary を解釈できませんでした',
      `ffmpeg ${args.join(' ')}`,
      0,
      stderr,
    )
  }

  return measurement
}
