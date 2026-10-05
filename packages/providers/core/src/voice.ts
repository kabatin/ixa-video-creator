import type { CharTime, TimedSegment, VoiceToolId, VoiceTuning } from '@ixa/domain'

/**
 * 声と文字起こしの AI の口（ADR-0038）。どちらも 1 回の要求で終わる（生成のように待ち合わせない）。
 * 結果の音は手元のファイルに書く（外の URL を取りに行かない）。
 *
 * **鍵と原稿は記録（`record`）にもエラーの文にも入れない。**
 */

export type SpeakRequest = {
  /** 読ませる字（読み）。 */
  readonly text: string
  readonly model: string | null
  /** 声の種類（AI ごとの声の名前や ID）。 */
  readonly voiceName: string
  /** 声のイメージ（自然な文）。 */
  readonly styleNote: string
  /** この行だけの演出。 */
  readonly direction: string
  readonly speed: number
  readonly tuning: VoiceTuning
  readonly language: string
  /** 書く先（拡張子なし）。拡張子は AI が決める。 */
  readonly outputBasePath: string
  readonly signal?: AbortSignal
}

export type SpeakResult = {
  readonly audioPath: string
  /** 送った字（読み）の 1 字ごとの時刻。返さない AI は null。 */
  readonly charTimes: readonly CharTime[] | null
  readonly costUsd: number
  /** 調べるための記録（鍵や原稿は入れない）。 */
  readonly record: Readonly<Record<string, unknown>>
}

/** 選べる声。 */
export type VoiceOption = {
  readonly id: string
  readonly label: string
  /** 声の特徴（例: 落ち着いた・明るい）。無ければ null。 */
  readonly note: string | null
}

export type VoiceModelOption = { readonly id: string; readonly label: string }

export type VoiceAdapter = {
  readonly tool: VoiceToolId
  /** 選べるモデル。モデルの無い AI（Mac の声・お試し）は空。 */
  readonly models: readonly VoiceModelOption[]
  readonly listVoices: (language: string) => Promise<readonly VoiceOption[]>
  readonly speak: (request: SpeakRequest) => Promise<SpeakResult>
}

export type TranscribeRequest = {
  readonly audioPath: string
  readonly language: string
  /** 聞き取りを寄せたい言葉（登場人物の名前など）。使えない AI は無視する。 */
  readonly keyterms: readonly string[]
  /** 作業用のフォルダ（変換したファイルを置く）。 */
  readonly workDir: string
  /** 音の長さ（秒）。費用の計算に使う。 */
  readonly durationSec: number
  readonly signal?: AbortSignal
}

export type TranscribeResult = {
  readonly text: string
  /** 聞き取った字ごとの時刻。返さない AI は null（区間だけ）。 */
  readonly chars: readonly CharTime[] | null
  readonly segments: readonly TimedSegment[]
  readonly costUsd: number
  readonly record: Readonly<Record<string, unknown>>
}

export type TranscribeToolId = 'stub' | 'whisper_cpp' | 'elevenlabs' | 'gemini_api'

export type Transcriber = {
  readonly tool: TranscribeToolId
  readonly transcribe: (request: TranscribeRequest) => Promise<TranscribeResult>
}

/** 声・文字起こしの AI の失敗。画面にそのまま出せる文を持つ（鍵・原稿・URL は入れない）。 */
export type VoiceFailureCode = 'rate_limited' | 'auth' | 'bad_request' | 'bad_response' | 'unavailable' | 'cancelled'

export class VoiceProviderError extends Error {
  readonly code: VoiceFailureCode
  readonly retryable: boolean

  constructor(code: VoiceFailureCode, message: string, retryable: boolean) {
    super(message)
    this.name = 'VoiceProviderError'
    this.code = code
    this.retryable = retryable
  }
}

/** HTTP の状態から失敗の種類を決める。`who` は画面に出す AI の名前。 */
export const voiceFailureFromStatus = (who: string, status: number): VoiceProviderError => {
  if (status === 429) {
    return new VoiceProviderError(
      'rate_limited',
      `${who} の回数の上限に達しました（無料枠は 1 日の回数に上限があります）。時間を置くか、有料の設定にしてください`,
      true,
    )
  }
  if (status === 401 || status === 403) {
    return new VoiceProviderError('auth', `${who} に鍵を受け付けてもらえませんでした。.env の鍵を確かめてください`, false)
  }
  if (status >= 500) return new VoiceProviderError('unavailable', `${who} が応答しませんでした（${status}）。時間を置いてやり直してください`, true)
  return new VoiceProviderError('bad_request', `${who} が要求を受け付けませんでした（${status}）`, false)
}
