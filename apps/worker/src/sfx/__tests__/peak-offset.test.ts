import { describe, expect, it } from 'vitest'
import { PEAK_WINDOW_SEC, wavPeakOffsetSec } from '../peak-offset.js'

/** できた効果音の WAV で、鳴り始めから一番大きいところまでの秒を測る（ADR-0054 追記）。 */

type Format = { readonly sampleRate?: number; readonly channels?: number; readonly bits?: 16 | 32; readonly float?: boolean }

/** 振幅の列（-1〜1、チャンネルを交互に並べたもの）から WAV を作る。 */
const wav = (samples: readonly number[], format: Format = {}): Uint8Array => {
  const sampleRate = format.sampleRate ?? 8000
  const channels = format.channels ?? 1
  const bits = format.bits ?? 16
  const bytesPer = bits / 8
  const dataBytes = samples.length * bytesPer
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i))
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, format.float === true ? 3 : 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels * bytesPer, true)
  view.setUint16(32, channels * bytesPer, true)
  view.setUint16(34, bits, true)
  text(36, 'data')
  view.setUint32(40, dataBytes, true)
  samples.forEach((value, i) => {
    if (format.float === true) view.setFloat32(44 + i * 4, value, true)
    else view.setInt16(44 + i * 2, Math.round(value * 32767), true)
  })
  return new Uint8Array(buffer)
}

/** 長さ `sec` の音で、`peakAt` 秒のあたりだけ大きい（ほかは小さな雑音）。 */
const burst = (sec: number, peakAt: number, sampleRate = 8000): number[] =>
  Array.from({ length: Math.round(sec * sampleRate) }, (_, i) => {
    const t = i / sampleRate
    const loud = Math.abs(t - peakAt) < 0.01 ? 0.9 : 0.05
    return loud * (i % 2 === 0 ? 1 : -1)
  })

describe('wavPeakOffsetSec', () => {
  it('一番大きいところの秒を返す（窓の幅の誤差で）', () => {
    expect(wavPeakOffsetSec(wav(burst(1, 0.4)))).toBeCloseTo(0.4, 1)
    expect(Math.abs((wavPeakOffsetSec(wav(burst(1, 0.4))) ?? 0) - 0.4)).toBeLessThanOrEqual(PEAK_WINDOW_SEC)
  })

  it('頭が一番大きい音は 0 に近い', () => {
    expect(wavPeakOffsetSec(wav(burst(0.5, 0.005)))).toBeLessThanOrEqual(PEAK_WINDOW_SEC)
  })

  it('ステレオでも、左右の大きい方で測る', () => {
    const mono = burst(1, 0.7)
    const stereo = mono.flatMap((value) => [value * 0.1, value])
    expect(wavPeakOffsetSec(wav(stereo, { channels: 2 }))).toBeCloseTo(0.7, 1)
  })

  it('32 bit の浮動小数の WAV も読む', () => {
    expect(wavPeakOffsetSec(wav(burst(1, 0.25), { bits: 32, float: true }))).toBeCloseTo(0.25, 1)
  })

  it('無音は測れない（null）', () => {
    expect(wavPeakOffsetSec(wav(Array.from({ length: 8000 }, () => 0)))).toBeNull()
  })

  it('窓 1 つに満たない短い音でも、その中の一番大きいところを返す', () => {
    const short = [0, 0.1, 0.8, 0.2, 0]
    expect(wavPeakOffsetSec(wav(short))).toBeCloseTo(2 / 8000, 5)
  })

  it('中身の無い WAV・WAV でないものは測れない（null）', () => {
    expect(wavPeakOffsetSec(wav([]))).toBeNull()
    expect(wavPeakOffsetSec(new Uint8Array([1, 2, 3]))).toBeNull()
    expect(wavPeakOffsetSec(new TextEncoder().encode('not a wav file at all, just text'))).toBeNull()
  })
})
