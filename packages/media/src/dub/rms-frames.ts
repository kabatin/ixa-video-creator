import { readFile } from 'node:fs/promises'
import { runFfmpeg } from '../ffmpeg-runner.js'

/**
 * 声の差し替え（ADR-0062）で測る音の大きさ。音を 16kHz・モノラルの PCM にし、窓ごとの RMS を dBFS にする。
 *
 * - 声の区間: 窓 400・刻み 160（10ms）。`@ixa/domain` の `speechChunks` に渡す
 * - 音量合わせ: 窓 1024・刻み 256。`voicedLevelDb` に渡す
 */

export const DUB_PCM_RATE = 16000
export const SPEECH_FRAME = { frame: 400, hop: 160 } as const
export const LEVEL_FRAME = { frame: 1024, hop: 256 } as const

const PCM_FULL_SCALE = 32768

export type FrameShape = { readonly frame: number; readonly hop: number }

/** 窓ごとの RMS（dBFS）。無音の窓は -Infinity。窓が 1 つも取れない短い音は空。 */
export const rmsFramesFromPcm = (samples: Int16Array, shape: FrameShape = SPEECH_FRAME): readonly number[] => {
  if (samples.length < shape.frame) return []
  const count = Math.floor((samples.length - shape.frame) / shape.hop) + 1
  return Array.from({ length: count }, (_, i) => {
    let sum = 0
    const start = i * shape.hop
    for (let j = start; j < start + shape.frame; j += 1) {
      const value = (samples[j] ?? 0) / PCM_FULL_SCALE
      sum += value * value
    }
    const rms = Math.sqrt(sum / shape.frame)
    return rms === 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(rms)
  })
}

/** 音を 16kHz・モノラルの生の PCM（s16le）に書き出して読む。`rawPath` は作業用のファイル。 */
export const readPcm16k = async (inputPath: string, rawPath: string): Promise<Int16Array> => {
  await runFfmpeg(['-y', '-i', inputPath, '-vn', '-map', '0:a:0', '-ac', '1', '-ar', String(DUB_PCM_RATE), '-f', 's16le', '-c:a', 'pcm_s16le', rawPath])
  const raw = await readFile(rawPath)
  return new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2))
}

/** 秒の区間の PCM（16kHz）。区間の外は切る。 */
export const slicePcm = (samples: Int16Array, startSec: number, endSec: number): Int16Array =>
  samples.subarray(Math.max(0, Math.floor(startSec * DUB_PCM_RATE)), Math.min(samples.length, Math.ceil(endSec * DUB_PCM_RATE)))

/** 素材の音を 10ms 刻みの RMS（dBFS）にする。 */
export const readRmsFrames = async (inputPath: string, rawPath: string): Promise<readonly number[]> =>
  rmsFramesFromPcm(await readPcm16k(inputPath, rawPath), SPEECH_FRAME)
