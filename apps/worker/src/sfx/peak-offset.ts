/**
 * できた効果音の WAV で、鳴り始めから一番大きいところまでの秒を測る（ADR-0054 追記）。**純粋。**
 * 動きの出来事に合わせて置くとき、この秒だけ前へ寄せる（domain の `sfxClipStartSec`）。
 *
 * 1 サンプルの尖りに引かれないよう、10 ms の窓の RMS が最大の窓を選び、その中で最も大きいサンプルの時刻を返す。
 * 無音・中身の無い WAV・読めない形式は測れない（null。呼ぶ側は時刻のまま置く）。
 */

/** 窓の幅（秒）。 */
export const PEAK_WINDOW_SEC = 0.01

type WavFormat = {
  readonly audioFormat: number
  readonly channels: number
  readonly sampleRate: number
  readonly bitsPerSample: number
}

const PCM = 1
const IEEE_FLOAT = 3
const EXTENSIBLE = 0xfffe

const ascii = (bytes: Uint8Array, offset: number): string =>
  String.fromCharCode(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0, bytes[offset + 3] ?? 0)

/** `fmt ` と `data` の塊を探す。見つからなければ null。 */
const findChunks = (bytes: Uint8Array): { readonly format: WavFormat; readonly data: DataView } | null => {
  if (bytes.length < 12 || ascii(bytes, 0) !== 'RIFF' || ascii(bytes, 8) !== 'WAVE') return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let format: WavFormat | null = null
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'fmt ' && size >= 16) {
      format = {
        audioFormat: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      }
    }
    if (id === 'data' && format !== null) {
      const length = Math.min(size, bytes.length - body)
      return { format, data: new DataView(bytes.buffer, bytes.byteOffset + body, length) }
    }
    offset = body + size + (size % 2)
  }
  return null
}

/** 1 サンプルを -1〜1 で読む口。対応しない形式なら null。 */
const sampleReader = (format: WavFormat): ((view: DataView, byte: number) => number) | null => {
  const kind = format.audioFormat === EXTENSIBLE ? (format.bitsPerSample === 32 ? IEEE_FLOAT : PCM) : format.audioFormat
  if (kind === IEEE_FLOAT && format.bitsPerSample === 32) return (view, byte) => view.getFloat32(byte, true)
  if (kind !== PCM) return null
  switch (format.bitsPerSample) {
    case 16:
      return (view, byte) => view.getInt16(byte, true) / 32768
    case 24:
      return (view, byte) => {
        const value = view.getUint8(byte) | (view.getUint8(byte + 1) << 8) | (view.getInt8(byte + 2) << 16)
        return value / 8388608
      }
    case 32:
      return (view, byte) => view.getInt32(byte, true) / 2147483648
    default:
      return null
  }
}

export const wavPeakOffsetSec = (bytes: Uint8Array): number | null => {
  const chunks = findChunks(bytes)
  if (chunks === null) return null
  const { format, data } = chunks
  const read = sampleReader(format)
  if (read === null || format.channels < 1 || format.sampleRate <= 0) return null
  const frameBytes = (format.bitsPerSample / 8) * format.channels
  const frames = Math.floor(data.byteLength / frameBytes)
  if (frames === 0) return null

  /** そのコマの左右の大きい方の振幅。 */
  const amplitude = (frame: number): number => {
    let loudest = 0
    for (let channel = 0; channel < format.channels; channel += 1) {
      loudest = Math.max(loudest, Math.abs(read(data, frame * frameBytes + channel * (format.bitsPerSample / 8))))
    }
    return loudest
  }

  const window = Math.max(1, Math.round(PEAK_WINDOW_SEC * format.sampleRate))
  let bestWindow = 0
  let bestEnergy = 0
  for (let start = 0; start < frames; start += window) {
    let energy = 0
    for (let frame = start; frame < Math.min(frames, start + window); frame += 1) energy += amplitude(frame) ** 2
    if (energy > bestEnergy) {
      bestEnergy = energy
      bestWindow = start
    }
  }
  if (bestEnergy === 0) return null

  let peakFrame = bestWindow
  for (let frame = bestWindow; frame < Math.min(frames, bestWindow + window); frame += 1) {
    if (amplitude(frame) > amplitude(peakFrame)) peakFrame = frame
  }
  return peakFrame / format.sampleRate
}
