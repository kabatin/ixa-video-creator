import { z } from 'zod'
import { describeError } from '@/lib/api-error'
import type { WaveformBands } from '@/lib/waveform-bands'

/**
 * 波形の点を署名付き URL から取ってくる（P56-2）。
 *
 * **API 本体とは経路が違う。** 解析結果の `waveformPeaksUrl` はオブジェクトストレージ
 * を直に指しており、`{ "success": ..., "data": ... }` の封筒も付かない。
 * だから `Requester` は通さず、ここで素の `fetch` を扱う。
 * 署名付き URL は期限があるので保持せず、解析結果を引き直すたびに使い捨てる。
 */

/** 実データは 2000 点・0〜1。範囲は `packages/music` が保存時に保証している。 */
const Series = z.array(z.number().min(0).max(1))

/**
 * v2（PHASE 8.1）から、音の大きさと 3 帯域が同じ JSON に乗る。**古い JSON（peaks だけ）も読む。**
 * 帯域の長さが peaks と食い違う JSON は壊れているので、帯域だけ捨てて振幅で描く。
 */
export const WaveformPeaksPayload = z.object({
  version: z.number().int().optional(),
  peaks: Series,
  rms: Series.optional(),
  low: Series.optional(),
  mid: Series.optional(),
  high: Series.optional(),
})
export type WaveformPeaksPayload = z.infer<typeof WaveformPeaksPayload>

/**
 * 取得の結果。
 *
 * **`failed` と `empty` を必ず分ける。** 点が 0 個なのを空配列で返すと、
 * 「取れなかった」まで同じ空配列に化け、画面は無音の曲として静かに描いてしまう
 * （lessons L-015）。呼び出し側に区別を強制するため、配列ではなくこの型を返す。
 */
export type WaveformPeaksResult =
  | {
      readonly status: 'ok'
      readonly peaks: readonly number[]
      /** 3 帯域。**null は古い解析**（再解析すると付く）。振幅だけで描く。 */
      readonly bands: WaveformBands | null
    }
  /** 取得も検証も成功したが、点が 1 つも無い。 */
  | { readonly status: 'empty' }
  /** 取得できなかった。理由は必ず message に残す。 */
  | { readonly status: 'failed'; readonly message: string }

export type FetchWaveformOptions = {
  /** テストから差し替えるための口。既定はグローバルの `fetch`。 */
  readonly fetchImpl?: typeof fetch
  readonly signal?: AbortSignal
}

const bandsOf = (data: WaveformPeaksPayload): WaveformBands | null => {
  const { rms, low, mid, high, peaks } = data
  if (rms === undefined || low === undefined || mid === undefined || high === undefined) return null
  const length = peaks.length
  if ([rms, low, mid, high].some((series) => series.length !== length)) return null
  return { rms, low, mid, high }
}

const failed = (message: string): WaveformPeaksResult => ({ status: 'failed', message })

const parseJson = (text: string): unknown => JSON.parse(text) as unknown

/**
 * 署名付き URL から波形の点を取る。
 *
 * 例外を投げずに結果型で返す。握り潰しているわけではなく、
 * 「取れなかった」は波形画面では**表示すべき状態**であり、
 * 画面を落とすべき異常ではないため。理由は必ず `message` に載る。
 */
export const fetchWaveformPeaks = async (
  url: string,
  options: FetchWaveformOptions = {},
): Promise<WaveformPeaksResult> => {
  const fetchImpl = options.fetchImpl ?? fetch
  const context = '波形データ'

  let text: string
  try {
    const response = await fetchImpl(url, { cache: 'no-store', signal: options.signal })
    if (!response.ok) {
      return failed(`${context}の取得に失敗しました（HTTP ${String(response.status)}）。`)
    }
    text = await response.text()
  } catch (cause) {
    return failed(`${context}に接続できませんでした — ${describeError(cause)}`)
  }

  let json: unknown
  try {
    json = parseJson(text)
  } catch (cause) {
    return failed(`${context}が JSON ではありません — ${describeError(cause)}`)
  }

  const parsed = WaveformPeaksPayload.safeParse(json)
  if (!parsed.success) {
    return failed(`${context}の形が想定と違います — ${parsed.error.issues[0]?.message ?? '検証に失敗'}`)
  }

  const data = parsed.data
  if (data.peaks.length === 0) return { status: 'empty' }
  return { status: 'ok', peaks: data.peaks, bands: bandsOf(data) }
}

/** 描画に使える点。`ok` 以外は空配列になるが、**状態の判定に使わないこと。** */
export const peaksOf = (result: WaveformPeaksResult): readonly number[] =>
  result.status === 'ok' ? result.peaks : []
