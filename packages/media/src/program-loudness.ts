import { measureLoudness, type LoudnessMeasurement } from './audio.js'
import { runFfmpeg } from './ffmpeg-runner.js'
import { probeMedia } from './probe.js'

/**
 * 書き出しの音量を揃える（ADR-0039）。YouTube・SNS の基準（-14 LUFS・トゥルーピーク -1.5 dBTP）に、
 * ffmpeg の loudnorm を 2 回（測る → 直す）通して合わせる。**映像はそのまま写し、音だけ作り直す。**
 * 1 回だけ（動的）だと曲の抑揚まで潰れるので、測った値を渡して線形に直す。
 */

export const PROGRAM_TARGET_LUFS = -14
const TARGET_TP = -1.5
const TARGET_LRA = 11
const TARGET = `I=${PROGRAM_TARGET_LUFS}:TP=${TARGET_TP}:LRA=${TARGET_LRA}`

export type LoudnormMeasurement = {
  readonly inputI: number
  readonly inputTp: number
  readonly inputLra: number
  readonly inputThresh: number
  readonly targetOffset: number
}

/** 1 回目の JSON を読む。無音（-inf）や読めない出力なら null（直さずにそのまま使う）。 */
export const parseLoudnormJson = (stderr: string): LoudnormMeasurement | null => {
  const start = stderr.lastIndexOf('{')
  const end = stderr.lastIndexOf('}')
  if (start === -1 || end < start) return null
  let json: Record<string, unknown>
  try {
    json = JSON.parse(stderr.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
  const read = (key: string): number | null => {
    const value = Number.parseFloat(String(json[key]))
    return Number.isFinite(value) ? value : null
  }
  const inputI = read('input_i')
  const inputTp = read('input_tp')
  const inputLra = read('input_lra')
  const inputThresh = read('input_thresh')
  const targetOffset = read('target_offset')
  if (inputI === null || inputTp === null || inputLra === null || inputThresh === null || targetOffset === null) return null
  return { inputI, inputTp, inputLra, inputThresh, targetOffset }
}

export const programLoudnessArgs = (
  inputPath: string,
  outputPath: string,
  measured: LoudnormMeasurement,
  audioBitrate: string,
): readonly string[] => [
  '-y', '-i', inputPath, '-map', '0:v?', '-map', '0:a', '-c:v', 'copy',
  '-af',
  `loudnorm=${TARGET}:measured_I=${measured.inputI}:measured_TP=${measured.inputTp}:measured_LRA=${measured.inputLra}:measured_thresh=${measured.inputThresh}:offset=${measured.targetOffset}:linear=true`,
  // loudnorm は内部で 192kHz に上げるので、出力を 48kHz に戻す。
  '-ar', '48000', '-c:a', 'aac', '-b:a', audioBitrate, '-movflags', '+faststart', outputPath,
]

/**
 * 揃えて書き、揃えた後の大きさを返す。音が無い・無音なら書かずに null（呼び出し側は元のファイルを使う）。
 */
export const normalizeProgramLoudness = async (
  inputPath: string,
  outputPath: string,
  audioBitrate: string,
): Promise<LoudnessMeasurement | null> => {
  const probe = await probeMedia(inputPath)
  if (probe.hasAudio !== true) return null
  const { stderr } = await runFfmpeg(['-hide_banner', '-nostats', '-i', inputPath, '-map', '0:a', '-af', `loudnorm=${TARGET}:print_format=json`, '-f', 'null', '-'])
  const measured = parseLoudnormJson(stderr)
  if (measured === null) return null
  await runFfmpeg(programLoudnessArgs(inputPath, outputPath, measured, audioBitrate))
  return measureLoudness(outputPath)
}

/**
 * 仕上げ「山だけ抑える」（ADR-0060。作品の `masteringMode` が `peak`）。**全体の大きさはそろえない。**
 * セリフのある作品で全体を -14 LUFS にそろえると、声の大きさに合わせて曲まで上下し、Take の声と曲の釣り合いが崩れる。
 * -1.5 dBFS を超える山だけを alimiter で抑える（`level=disabled`: alimiter の既定の自動の持ち上げを切る）。
 */
export const PROGRAM_PEAK_LIMIT_DBFS = -1.5
const PEAK_LIMIT_LINEAR = (10 ** (PROGRAM_PEAK_LIMIT_DBFS / 20)).toFixed(6)

export const programPeakLimitArgs = (inputPath: string, outputPath: string, audioBitrate: string): readonly string[] => [
  '-y', '-i', inputPath, '-map', '0:v?', '-map', '0:a', '-c:v', 'copy',
  '-af', `alimiter=limit=${PEAK_LIMIT_LINEAR}:level=disabled`,
  '-c:a', 'aac', '-b:a', audioBitrate, '-movflags', '+faststart', outputPath,
]

/** 山を抑えて書き、書いた後の大きさを測って返す（記録するだけ）。音が無ければ書かずに null。 */
export const limitProgramPeaks = async (
  inputPath: string,
  outputPath: string,
  audioBitrate: string,
): Promise<LoudnessMeasurement | null> => {
  const probe = await probeMedia(inputPath)
  if (probe.hasAudio !== true) return null
  await runFfmpeg(programPeakLimitArgs(inputPath, outputPath, audioBitrate))
  return measureLoudness(outputPath)
}
