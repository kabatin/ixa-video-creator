import type { DubWarning } from './dub-record.js'
import type { ChunkPair } from './pair-chunks.js'
import { roundMs, type DubChunk } from './speech-chunks.js'

/**
 * 倍率と置き方（ADR-0062）。区間ごとに一定の倍率で伸縮する（細かく変えると声が二重に聞こえた。AnimalVideo）。
 *
 * - 倍率は 0.8〜1.6。**1.6 を超えたら止める**（AnimalVideo の 1.8 までの詰め込みは使わない。制作者の決め）
 * - 1.4 を超えたら警告（早口に聞こえる）
 */

export const DUB_MIN_TEMPO = 0.8
export const DUB_MAX_TEMPO = 1.6
export const DUB_WARN_TEMPO = 1.4
/** 組の中の間を詰めるとき、語頭の前に残す長さ。置くときもこの分だけ前に出す。 */
export const DUB_ONSET_KEEP_SEC = 0.04
/** 語尾の後に残す長さ。 */
export const DUB_OFFSET_KEEP_SEC = 0.06
/** 次の区間との間に必ず残す長さ（声を重ねない）。 */
export const DUB_NEXT_GAP_SEC = 0.03
/** `cutSec` で切るときの最後のフェード。 */
export const DUB_CUT_FADE_SEC = 0.15

const EPS = 1e-9

export const FAST_TEMPO_MESSAGE = '早口に聞こえます。読み方の指示か Shot の指示を直してください'

export type TempoResult =
  | { readonly ok: true; readonly tempo: number; readonly rawTempo: number; readonly warnings: readonly DubWarning[] }
  | { readonly ok: false; readonly rawTempo: number; readonly reason: string }

const overMaxReason = (raw: number): string =>
  `読み上げが長すぎます（${raw.toFixed(2)} 倍に縮める必要があり、上限は ${DUB_MAX_TEMPO} 倍です）。読み方の指示か Shot の指示を直してください`

/** 倍率（読み上げの長さ ÷ 置く長さ）を丸める。1.6 を超えたら止める。 */
export const chunkTempo = (rawTempo: number): TempoResult => {
  if (!Number.isFinite(rawTempo) || rawTempo <= 0) return { ok: false, rawTempo, reason: '読み上げの長さを測れませんでした' }
  if (rawTempo > DUB_MAX_TEMPO + EPS) return { ok: false, rawTempo, reason: overMaxReason(rawTempo) }
  if (rawTempo < DUB_MIN_TEMPO - EPS) {
    return {
      ok: true,
      tempo: DUB_MIN_TEMPO,
      rawTempo,
      warnings: [{ code: 'slow_tempo_clamped', message: `読み上げが口より短いので、${DUB_MIN_TEMPO} 倍までだけ伸ばしました` }],
    }
  }
  return {
    ok: true,
    tempo: rawTempo,
    rawTempo,
    warnings: rawTempo > DUB_WARN_TEMPO + EPS ? [{ code: 'fast_tempo', message: FAST_TEMPO_MESSAGE }] : [],
  }
}

/** 区間の頭と尻に残す分を足し、重なった所は 1 つにつなぐ（読み上げの時刻のまま）。 */
const piecesOf = (parts: readonly DubChunk[], ttsDurationSec: number): readonly DubChunk[] =>
  parts
    .map((part) => ({
      startSec: roundMs(Math.max(0, part.startSec - DUB_ONSET_KEEP_SEC)),
      endSec: roundMs(Math.min(ttsDurationSec, part.endSec + DUB_OFFSET_KEEP_SEC)),
    }))
    .reduce<readonly DubChunk[]>((acc, piece) => {
      const previous = acc[acc.length - 1]
      if (previous !== undefined && piece.startSec <= previous.endSec + EPS) {
        return [...acc.slice(0, -1), { startSec: previous.startSec, endSec: Math.max(previous.endSec, piece.endSec) }]
      }
      return [...acc, piece]
    }, [])

export type LipPlan =
  | {
      readonly ok: true
      /** 読み上げから切り出してつなぐ所（読み上げの時刻）。つなぎ目は 8ms でフェードする。 */
      readonly pieces: readonly DubChunk[]
      readonly tempo: number
      readonly rawTempo: number
      /** 置く時刻（Shot の頭から）。元の区間の頭の 0.04 秒前。 */
      readonly placedStartSec: number
      /** 置いた声の終わり。次の区間に掛かる所は切る。 */
      readonly placedEndSec: number
      /** 次の区間に掛かって切ったか。 */
      readonly cut: boolean
      readonly warnings: readonly DubWarning[]
    }
  | { readonly ok: false; readonly rawTempo: number; readonly reason: string }

/** 口に合わせる 1 組の置き方。倍率 = （詰めた長さ − 残した分）÷ 元の区間の長さ。 */
export const planLipPair = (
  pair: ChunkPair,
  context: { readonly ttsDurationSec: number; readonly nextSourceStartSec: number | null },
): LipPlan => {
  const pieces = piecesOf(pair.tts, context.ttsDurationSec)
  const ttsLenSec = pieces.reduce((sum, piece) => sum + (piece.endSec - piece.startSec), 0)
  const sourceLenSec = pair.source.endSec - pair.source.startSec
  const tempo = chunkTempo((ttsLenSec - DUB_ONSET_KEEP_SEC - DUB_OFFSET_KEEP_SEC) / sourceLenSec)
  if (!tempo.ok) return tempo
  const placedStartSec = roundMs(Math.max(0, pair.source.startSec - DUB_ONSET_KEEP_SEC))
  const naturalEnd = placedStartSec + ttsLenSec / tempo.tempo
  const limit = context.nextSourceStartSec === null ? Number.POSITIVE_INFINITY : context.nextSourceStartSec - DUB_NEXT_GAP_SEC
  const cut = naturalEnd > limit + EPS
  return {
    ok: true,
    pieces,
    tempo: tempo.tempo,
    rawTempo: tempo.rawTempo,
    placedStartSec,
    placedEndSec: cut ? roundMs(limit) : naturalEnd,
    cut,
    warnings: [
      ...tempo.warnings,
      ...(cut ? [{ code: 'cut_by_next' as const, message: '次の声に重なる所を切りました' }] : []),
    ],
  }
}

/** `fitSec`: 長いときだけ縮める（倍率 = 長さ ÷ 収める長さ）。短いときは 1 倍。 */
export const fitTempo = (lengthSec: number, fitSec: number): TempoResult => {
  if (lengthSec <= fitSec + EPS) return { ok: true, tempo: 1, rawTempo: 1, warnings: [] }
  return chunkTempo(lengthSec / fitSec)
}

/** `cutSec`: 縮めずに切る。切るときだけ最後をフェードする。 */
export const cutPlan = (lengthSec: number, cutSec: number): { readonly durationSec: number; readonly fadeOutSec: number } =>
  lengthSec <= cutSec + EPS ? { durationSec: lengthSec, fadeOutSec: 0 } : { durationSec: cutSec, fadeOutSec: DUB_CUT_FADE_SEC }
