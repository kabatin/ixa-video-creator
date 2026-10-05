import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { CharTime } from '@ixa/domain'
import type {
  SpeakRequest,
  SpeakResult,
  Transcriber,
  TranscribeRequest,
  TranscribeResult,
  VoiceAdapter,
} from '@ixa/provider-core'
import { z } from 'zod'
import { requestJson, type FetchLike } from './http.js'

/**
 * ElevenLabs の声と文字起こし（ADR-0038。有料）。形は 2026-10-05 の公式の説明に合わせる。
 *
 * - 声: `/with-timestamps` で読ませ、**送った字ごとの時刻**も受け取る（テロップの切り替えと強調に使う）
 * - 文字起こし: Scribe（`scribe_v2`）に字の時刻を頼む
 * - 鍵は `xi-api-key` ヘッダーだけ。声のイメージは調整の目安で、API には送らない（声の種類と調整で決まる）
 * - 費用は呼び出し側が決める（プランで単価が違う。ここは字数・長さを渡すだけ）
 */

const BASE = 'https://api.elevenlabs.io/v1'
const WHO = 'ElevenLabs'
const DEFAULT_MODEL = 'eleven_multilingual_v2'
/** 言語の指定を受け付けないモデル。 */
const NO_LANGUAGE_CODE = new Set(['eleven_multilingual_v2'])
const SPEED_MIN = 0.7
const SPEED_MAX = 1.2

export const ELEVENLABS_MODELS = [
  { id: 'eleven_v4', label: 'Eleven v4（新しい・表現が豊か）' },
  { id: 'eleven_multilingual_v2', label: 'Multilingual v2（安定）' },
  { id: 'eleven_flash_v2_5', label: 'Flash v2.5（速い・安い）' },
] as const

export type ElevenLabsDeps = {
  readonly apiKey: string
  readonly fetch: FetchLike
}

const Alignment = z.object({
  characters: z.array(z.string()),
  character_start_times_seconds: z.array(z.number()),
  character_end_times_seconds: z.array(z.number()),
})
const SpeakResponse = z.object({ audio_base64: z.string().min(1), alignment: Alignment.nullable().optional() })
const VoicesResponse = z.object({
  voices: z.array(
    z.object({ voice_id: z.string(), name: z.string(), labels: z.record(z.string()).nullable().optional() }),
  ),
})

/** 字と時刻の並びの長さが合うときだけ時刻にする（ずれた時刻で字幕を出さない）。 */
const charTimesOf = (alignment: z.infer<typeof Alignment> | null | undefined): readonly CharTime[] | null => {
  if (alignment === null || alignment === undefined) return null
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment
  if (starts.length !== characters.length || ends.length !== characters.length) return null
  return characters.map((char, i) => ({ char, startSec: starts[i] ?? 0, endSec: ends[i] ?? 0 }))
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

export const createElevenLabsVoice = (deps: ElevenLabsDeps & { readonly costOf: (chars: number) => number }): VoiceAdapter => ({
  tool: 'elevenlabs',
  models: ELEVENLABS_MODELS,
  listVoices: async () => {
    const response = await requestJson(deps.fetch, WHO, `${BASE}/voices`, { method: 'GET', headers: { 'xi-api-key': deps.apiKey } }, VoicesResponse)
    return response.voices.map((voice) => {
      const labels = Object.values(voice.labels ?? {}).filter((label) => label.trim() !== '')
      return { id: voice.voice_id, label: voice.name, note: labels.length === 0 ? null : labels.join('・') }
    })
  },
  speak: async (request: SpeakRequest): Promise<SpeakResult> => {
    const model = request.model ?? DEFAULT_MODEL
    const { stability, similarity, style } = request.tuning
    const body = {
      text: request.text,
      model_id: model,
      ...(NO_LANGUAGE_CODE.has(model) ? {} : { language_code: request.language.slice(0, 2) }),
      voice_settings: {
        ...(stability === undefined ? {} : { stability }),
        ...(similarity === undefined ? {} : { similarity_boost: similarity }),
        ...(style === undefined ? {} : { style }),
        speed: clamp(request.speed, SPEED_MIN, SPEED_MAX),
      },
    }
    const response = await requestJson(
      deps.fetch,
      WHO,
      `${BASE}/text-to-speech/${encodeURIComponent(request.voiceName)}/with-timestamps?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'xi-api-key': deps.apiKey },
        body: JSON.stringify(body),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      },
      SpeakResponse,
    )
    const audioPath = `${request.outputBasePath}.mp3`
    await writeFile(audioPath, Buffer.from(response.audio_base64, 'base64'))
    const chars = [...request.text].length
    return {
      audioPath,
      charTimes: charTimesOf(response.alignment),
      costUsd: deps.costOf(chars),
      record: { tool: 'elevenlabs', model, voice: request.voiceName, chars },
    }
  },
})

const ScribeCharacter = z.object({ text: z.string(), start: z.number(), end: z.number() })
const ScribeResponse = z.object({
  text: z.string(),
  words: z.array(
    z.object({
      text: z.string(),
      start: z.number(),
      end: z.number(),
      type: z.string(),
      characters: z.array(ScribeCharacter).nullable().optional(),
    }),
  ),
})

const spreadWord = (text: string, startSec: number, endSec: number): readonly CharTime[] => {
  const chars = [...text]
  const step = chars.length === 0 ? 0 : (endSec - startSec) / chars.length
  return chars.map((char, i) => ({ char, startSec: startSec + i * step, endSec: startSec + (i + 1) * step }))
}

export const createElevenLabsTranscriber = (
  deps: ElevenLabsDeps & { readonly costOf: (durationSec: number) => number },
): Transcriber => ({
  tool: 'elevenlabs',
  transcribe: async (request: TranscribeRequest): Promise<TranscribeResult> => {
    const form = new FormData()
    form.append('model_id', 'scribe_v2')
    form.append('language_code', request.language.slice(0, 2))
    form.append('timestamps_granularity', 'character')
    form.append('tag_audio_events', 'false')
    for (const term of request.keyterms) form.append('keyterms', term)
    form.append('file', new Blob([await readFile(request.audioPath)]), basename(request.audioPath))
    const response = await requestJson(
      deps.fetch,
      WHO,
      `${BASE}/speech-to-text`,
      { method: 'POST', headers: { 'xi-api-key': deps.apiKey }, body: form, ...(request.signal === undefined ? {} : { signal: request.signal }) },
      ScribeResponse,
    )
    // 音の出来事（笑い声など）は字にしない。
    const spoken = response.words.filter((word) => word.type !== 'audio_event')
    return {
      text: response.text,
      chars: spoken.flatMap((word) =>
        word.characters === null || word.characters === undefined || word.characters.length === 0
          ? spreadWord(word.text, word.start, word.end)
          : word.characters.map((c) => ({ char: c.text, startSec: c.start, endSec: c.end })),
      ),
      segments: spoken.map((word) => ({ text: word.text, startSec: word.start, endSec: word.end })),
      costUsd: deps.costOf(request.durationSec),
      record: { tool: 'elevenlabs', model: 'scribe_v2', words: response.words.length },
    }
  },
})
