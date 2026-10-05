/**
 * WAV（16 ビット・モノラルの PCM）。お試しの声と、頭の無い PCM を返す AI（Gemini の流し読み）に使う。
 */

const HEADER_BYTES = 44
const DEFAULT_RATE = 24000

/** 頭の無い 16 ビット・モノラルの PCM を WAV に包む。 */
export const wavFromPcm = (pcm: Buffer, sampleRate: number): Buffer => {
  const header = Buffer.alloc(HEADER_BYTES)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

export const pcm16Wav = (samples: Int16Array, sampleRate: number): Buffer =>
  wavFromPcm(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength), sampleRate)

/** `audio/L16;codec=pcm;rate=24000` の rate。無ければ 24000。 */
export const rateFromMime = (mimeType: string): number => {
  const rate = /rate=(\d+)/i.exec(mimeType)?.[1]
  return rate === undefined ? DEFAULT_RATE : Number(rate)
}
