import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type { TranscriptWord } from '@ixa/domain'
import { DUB_PCM_RATE } from '@ixa/media'
import { z } from 'zod'

/**
 * 行の区間を決める手がかりの文字起こし（ADR-0062）。apps/audio の `POST /transcribe`（faster-whisper）を呼ぶ。
 *
 * apps/audio は音をパスで受ける（`AUDIO_ROOT` の中だけ）ので、元の Take の音（16 kHz・モノラル）を
 * `AUDIO_ROOT/dub-<ジョブ>/source.wav` に書き、`AUDIO_ROOT` からの相対パスを渡す（音楽の解析と同じ）。
 * 書いた音は終わったら消す。応答は zod で確かめる。失敗は例外にする（呼び出し側が長さの割り当てに戻し、痕跡を残す）。
 */

export type DubTranscribeInput = {
  /** 元の Take の音（16 kHz・モノラル・16 ビット）。 */
  readonly pcm: Int16Array
  /** 書く場所の名前（ジョブの ID）。 */
  readonly key: string
  /** 台本（語の綴りを寄せる）。 */
  readonly prompt: string
}

export type DubTranscriber = (input: DubTranscribeInput) => Promise<readonly TranscriptWord[]>

const TIMEOUT_MS = 5 * 60 * 1000
const MAX_PROMPT_CHARS = 2000

const Sec = z.number().finite().min(0)
const WordWire = z.object({ start: Sec, end: Sec, text: z.string() })
const TranscribeWire = z.object({
  segments: z.array(z.object({ start: Sec, end: Sec, text: z.string(), words: z.array(WordWire) })),
})

/** 16 ビット PCM の WAV（RIFF）。 */
export const wavFromPcm = (pcm: Int16Array, sampleRate: number): Uint8Array => {
  const data = pcm.byteLength
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data, 4)
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
  header.writeUInt32LE(data, 40)
  return Buffer.concat([header, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)])
}

/** 区切りの語（語が無い区切りは、区切りを 1 語とみなす）。 */
const wordsOf = (body: z.infer<typeof TranscribeWire>): readonly TranscriptWord[] =>
  body.segments.flatMap((segment) =>
    (segment.words.length > 0 ? segment.words : [segment]).map((word) => ({ startSec: word.start, endSec: word.end, text: word.text })),
  )

const detailOf = async (response: Response): Promise<string> => {
  const text = await response.text().catch(() => '')
  return text.slice(0, 200)
}

export const createAudioServiceTranscriber = (input: {
  readonly baseUrl: string
  readonly audioRoot: string
  readonly fetch?: typeof fetch
}): DubTranscriber => {
  const root = input.baseUrl.replace(/\/+$/, '')
  const doFetch = input.fetch ?? fetch
  return async ({ pcm, key, prompt }) => {
    const dir = join(input.audioRoot, `dub-${key}`)
    const path = join(dir, 'source.wav')
    const relativePath = relative(input.audioRoot, path)
    if (relativePath.split(sep).includes('..')) throw new Error(`文字起こしの音の置き場が AUDIO_ROOT の外です: ${relativePath}`)
    await mkdir(dir, { recursive: true })
    try {
      await writeFile(path, wavFromPcm(pcm, DUB_PCM_RATE))
      const response = await doFetch(`${root}/transcribe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          audio_path: relativePath.split(sep).join('/'),
          language: 'ja',
          initial_prompt: prompt.slice(0, MAX_PROMPT_CHARS),
          word_timestamps: true,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!response.ok) throw new Error(`文字起こしの口が ${String(response.status)} を返しました: ${await detailOf(response)}`)
      const parsed = TranscribeWire.safeParse(await response.json())
      if (!parsed.success) throw new Error(`文字起こしの応答の形が違います: ${parsed.error.issues[0]?.message ?? ''}`)
      return wordsOf(parsed.data)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
}
