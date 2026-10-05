import { readFile } from 'node:fs/promises'
import { measureLoudness, type LoudnessMeasurement } from './audio.js'
import { runFfmpeg } from './ffmpeg-runner.js'

/**
 * 声の音を整える（ADR-0038）。AI の声・録音を、タイムラインに置く前に同じくらいの大きさにする。
 *
 * - `loudnorm` は短い音（数秒）で振る舞いが読みにくいので使わない。**測った大きさから一定の増減（dB）を掛け**、
 *   頭打ち（リミッター）で割れを防ぐ。仕上げの -14 LUFS は書き出しで全体に掛ける（ADR-0039）
 * - 録音は低い雑音（空調など）を切り、軽いノイズ除去を先に掛ける
 */

/** 声の目安の大きさ（LUFS）。仕上げ（-14）より少し下に置き、BGM・効果音と混ぜる余白を残す。 */
export const VOICE_TARGET_LUFS = -16
const MAX_GAIN_DB = 20
/**
 * 頭打ち（約 -2 dBFS。AAC にすると少しはみ出すので余白を取る）。alimiter は既定で出力を 0 dBFS まで持ち上げる
 * （`level`）ので、それを切る（切らないと目標より大きくなり、トゥルーピークが 0 を超えた）。
 */
const LIMIT = 0.8
const PCM_PEAK = 32768

/** 目標との差（dB）。±20 dB まで。測れない（無音）なら 0。 */
export const voiceGainDb = (integratedLufs: number): number => {
  if (!Number.isFinite(integratedLufs)) return 0
  const gain = VOICE_TARGET_LUFS - integratedLufs
  return Math.round(Math.max(-MAX_GAIN_DB, Math.min(MAX_GAIN_DB, gain)) * 10) / 10
}

export const voiceNormalizeArgs = (
  inputPath: string,
  outputPath: string,
  options: { readonly gainDb: number; readonly denoise: boolean },
): readonly string[] => {
  const filters = [
    ...(options.denoise ? ['highpass=f=70', 'afftdn=nf=-25'] : []),
    `volume=${options.gainDb}dB`,
    `alimiter=limit=${LIMIT}:level=false`,
  ]
  return ['-y', '-i', inputPath, '-vn', '-ac', '1', '-ar', '48000', '-af', filters.join(','), '-c:a', 'aac', '-b:a', '160k', outputPath]
}

/** 整えて書き、整えた後の大きさを返す。 */
export const normalizeVoice = async (
  inputPath: string,
  outputPath: string,
  options: { readonly denoise: boolean },
): Promise<LoudnessMeasurement> => {
  const before = await measureLoudness(inputPath)
  await runFfmpeg(voiceNormalizeArgs(inputPath, outputPath, { gainDb: voiceGainDb(before.integratedLufs), denoise: options.denoise }))
  return measureLoudness(outputPath)
}

export const whisperWavArgs = (inputPath: string, outputPath: string): readonly string[] => [
  '-y', '-i', inputPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', outputPath,
]

/** whisper.cpp 向けの WAV（16kHz・モノラル・16 ビット）にする。 */
export const toWhisperWav = async (inputPath: string, outputPath: string): Promise<void> => {
  await runFfmpeg(whisperWavArgs(inputPath, outputPath))
}

/** 区切りごとの最大の振れ幅（0〜1、小数 3 桁）。点の数が音より多ければ音の数で返す。 */
export const peaksFromPcm = (samples: Int16Array, points: number): readonly number[] => {
  if (samples.length === 0 || points <= 0) return []
  const count = Math.min(points, samples.length)
  const size = samples.length / count
  return Array.from({ length: count }, (_, i) => {
    let max = 0
    for (let j = Math.floor(i * size); j < Math.floor((i + 1) * size); j += 1) {
      max = Math.max(max, Math.abs(samples[j] ?? 0))
    }
    return Math.round(Math.min(1, max / PCM_PEAK) * 1000) / 1000
  })
}

/** 波形の点を作る（8kHz の生の PCM に書き出してから数える）。`rawPath` は作業用のファイル。 */
export const readPeaks = async (inputPath: string, rawPath: string, points: number): Promise<readonly number[]> => {
  await runFfmpeg(['-y', '-i', inputPath, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', '-c:a', 'pcm_s16le', rawPath])
  const raw = await readFile(rawPath)
  return peaksFromPcm(new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2)), points)
}
