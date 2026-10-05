import { readFile, writeFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type { CharTime } from '@ixa/domain'
import {
  VoiceProviderError,
  type SpeakRequest,
  type SpeakResult,
  type Transcriber,
  type TranscribeRequest,
  type TranscribeResult,
  type VoiceAdapter,
  type VoiceOption,
} from '@ixa/provider-core'
import { z } from 'zod'
import { badResponse, requestJson, type FetchLike } from './http.js'
import { rateFromMime, wavFromPcm } from './wav.js'

/**
 * Gemini の声と文字起こし（ADR-0038）。形は 2026-10-05 の公式の説明に合わせる。
 *
 * - 声: `generateContent` に読みを送る。**読み方の指示は `speech_metadata.style`**（3.8 は本文をそのまま読むので、
 *   指示を本文に混ぜると読み上げてしまう）。声は `voiceConfig.voice`。WAV（24kHz・モノラル）が返る
 * - 文字起こし: `gemini-3.5-transcribe` に音を base64 で送り、語の時刻を頼む（30 分まで）
 * - 鍵は `x-goog-api-key` ヘッダーだけ（URL に入れない）
 * - 費用は呼び出し側が決める（無料枠か・2027 年の値上げは domain の規則。ここは使った量を渡すだけ）
 */

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const WHO = 'Gemini'
export const GEMINI_DEFAULT_TTS_MODEL = 'gemini-3.8-flash-tts'
const TRANSCRIBE_MODEL = 'gemini-3.5-transcribe'
/** 送る音の上限。base64 にすると約 1.33 倍になり、1 回の要求の上限（約 20MB）に収める。 */
const MAX_INLINE_AUDIO_BYTES = 14 * 1024 * 1024

export const GEMINI_TTS_MODELS = [
  { id: 'gemini-3.8-flash-tts', label: 'Gemini 3.8 Flash TTS' },
  { id: 'gemini-3.8-flash-lite-tts', label: 'Gemini 3.8 Flash-Lite TTS（安い）' },
] as const

/** 既製の声（30 種類）と特徴。特徴は公式の英語の 1 語を日本語にしたもの。 */
export const GEMINI_VOICES: readonly VoiceOption[] = (
  [
    ['Zephyr', '明るい'],
    ['Puck', '弾む'],
    ['Charon', '説明向き'],
    ['Kore', '芯がある'],
    ['Fenrir', '興奮ぎみ'],
    ['Leda', '若々しい'],
    ['Orus', '芯がある'],
    ['Aoede', '軽やか'],
    ['Callirrhoe', 'のんびり'],
    ['Autonoe', '明るい'],
    ['Enceladus', '息まじり'],
    ['Iapetus', 'はっきり'],
    ['Umbriel', 'のんびり'],
    ['Algieba', 'なめらか'],
    ['Despina', 'なめらか'],
    ['Erinome', 'はっきり'],
    ['Algenib', 'しゃがれ声'],
    ['Rasalgethi', '説明向き'],
    ['Laomedeia', '弾む'],
    ['Achernar', 'やわらか'],
    ['Alnilam', '芯がある'],
    ['Schedar', 'むらがない'],
    ['Gacrux', '大人びた'],
    ['Pulcherrima', '前に出る'],
    ['Achird', '親しみやすい'],
    ['Zubenelgenubi', 'くだけた'],
    ['Vindemiatrix', '穏やか'],
    ['Sadachbia', '生き生き'],
    ['Sadaltager', '物知り'],
    ['Sulafat', '温かい'],
  ] as const
).map(([id, note]) => ({ id, label: id, note }))

/** 声のイメージ・演出・速さを 1 つの読み方の指示にする（Gemini には速さの数値が無いので言葉で言う）。 */
export const geminiStyleOf = (styleNote: string, direction: string, speed: number): string => {
  const pace =
    speed <= 0.85 ? 'ゆっくり話す' : speed < 0.95 ? '少しゆっくり話す' : speed >= 1.15 ? '速めに話す' : speed > 1.05 ? '少し速めに話す' : ''
  return [styleNote.trim(), direction.trim(), pace].filter((part) => part !== '').join('。')
}

const AudioResponse = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({
          parts: z.array(z.object({ inlineData: z.object({ mimeType: z.string(), data: z.string() }).optional() })),
        }),
      }),
    )
    .min(1),
  usageMetadata: z.object({ candidatesTokenCount: z.number().optional() }).optional(),
})

export type GeminiDeps = {
  readonly apiKey: string
  readonly fetch: FetchLike
}

const headers = (apiKey: string): Record<string, string> => ({ 'content-type': 'application/json', 'x-goog-api-key': apiKey })

export const createGeminiVoice = (
  deps: GeminiDeps & { readonly costOf: (usage: { readonly model: string; readonly outputTokens: number }) => number },
): VoiceAdapter => ({
  tool: 'gemini_api',
  models: GEMINI_TTS_MODELS,
  listVoices: () => Promise.resolve(GEMINI_VOICES),
  speak: async (request: SpeakRequest): Promise<SpeakResult> => {
    const model = request.model ?? GEMINI_DEFAULT_TTS_MODEL
    const style = geminiStyleOf(request.styleNote, request.direction, request.speed)
    const body = {
      contents: [{ role: 'user', parts: [{ text: request.text, ...(style === '' ? {} : { speech_metadata: { style } }) }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { voice: request.voiceName } } },
    }
    const response = await requestJson(
      deps.fetch,
      WHO,
      `${BASE}/${model}:generateContent`,
      { method: 'POST', headers: headers(deps.apiKey), body: JSON.stringify(body), ...(request.signal === undefined ? {} : { signal: request.signal }) },
      AudioResponse,
    )
    const audio = response.candidates[0]?.content.parts.find((part) => part.inlineData !== undefined)?.inlineData
    if (audio === undefined) throw badResponse(WHO)
    const bytes = Buffer.from(audio.data, 'base64')
    const isWav = audio.mimeType.toLowerCase().includes('wav')
    const audioPath = `${request.outputBasePath}.wav`
    await writeFile(audioPath, isWav ? bytes : wavFromPcm(bytes, rateFromMime(audio.mimeType)))
    const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0
    return {
      audioPath,
      charTimes: null,
      costUsd: deps.costOf({ model, outputTokens }),
      record: { tool: 'gemini_api', model, voice: request.voiceName, outputTokens, mimeType: audio.mimeType },
    }
  },
})

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
}

const Word = z.object({ word: z.string(), startOffset: z.string(), endOffset: z.string() })
const Transcription = z.object({ words: z.array(Word) })
const TranscribeResponse = z.object({
  audioTranscription: Transcription.optional(),
  candidates: z.array(z.object({ audioTranscription: Transcription.optional() }).passthrough()).optional(),
})

/** "0.100s" → 0.1 */
const seconds = (offset: string): number => {
  const value = Number.parseFloat(offset.replace(/s$/, ''))
  if (!Number.isFinite(value)) throw badResponse(WHO)
  return value
}

/** 語の区間を字に等分する。 */
const spreadWord = (text: string, startSec: number, endSec: number): readonly CharTime[] => {
  const chars = [...text]
  const step = chars.length === 0 ? 0 : (endSec - startSec) / chars.length
  return chars.map((char, i) => ({ char, startSec: startSec + i * step, endSec: startSec + (i + 1) * step }))
}

export const createGeminiTranscriber = (deps: GeminiDeps & { readonly costOf: (durationSec: number) => number }): Transcriber => ({
  tool: 'gemini_api',
  transcribe: async (request: TranscribeRequest): Promise<TranscribeResult> => {
    const bytes = await readFile(request.audioPath)
    if (bytes.length > MAX_INLINE_AUDIO_BYTES) {
      throw new VoiceProviderError(
        'bad_request',
        'Gemini に送れる大きさ（約 14MB）を超えています。whisper.cpp か ElevenLabs で文字起こししてください',
        false,
      )
    }
    const mimeType = MIME_BY_EXT[extname(request.audioPath).toLowerCase()] ?? 'audio/wav'
    const body = {
      contents: [{ parts: [{ inlineData: { mimeType, data: bytes.toString('base64') } }] }],
      generationConfig: { audioTranscriptionConfig: { wordTimestamp: true } },
    }
    const response = await requestJson(
      deps.fetch,
      WHO,
      `${BASE}/${TRANSCRIBE_MODEL}:generateContent`,
      { method: 'POST', headers: headers(deps.apiKey), body: JSON.stringify(body), ...(request.signal === undefined ? {} : { signal: request.signal }) },
      TranscribeResponse,
    )
    const words = (response.audioTranscription ?? response.candidates?.find((c) => c.audioTranscription !== undefined)?.audioTranscription)?.words
    if (words === undefined) throw badResponse(WHO)
    const segments = words.map((word) => ({ text: word.word, startSec: seconds(word.startOffset), endSec: seconds(word.endOffset) }))
    return {
      text: segments.map((segment) => segment.text).join(''),
      chars: segments.flatMap((segment) => spreadWord(segment.text, segment.startSec, segment.endSec)),
      segments,
      costUsd: deps.costOf(request.durationSec),
      record: { tool: 'gemini_api', model: TRANSCRIBE_MODEL, words: words.length },
    }
  },
})
