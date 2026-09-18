import { Seconds, TakeId, TimelineDocument } from '@ixa/domain'
import { z } from 'zod'

/**
 * Take の A/B 比較の表示ロジック。**React を含まない純粋関数だけを置く。**
 *
 * 時間は常に秒（float）。ミリ秒・フレームをここへ持ち込まない（CLAUDE.md 規約 3）。
 * 入力は一切変更せず、常に新しい値を返す。
 *
 * **判定の正はサーバにある。** どの Take を並べられるか・拍が何件あるかは
 * `GET /shots/{id}/compare` が決める。ここがするのは「返ってきた符号を日本語にする」
 * 「区間に入る拍を選ぶ」「目盛りの位置を百分率に直す」の 3 つに限る（lessons L-016）。
 */

// --- ワイヤ表現 ---

/**
 * 比較が成立しなかった理由。**API の enum をそのまま写す。**
 * 増減したらここが `parse` で落ちるので、画面だけ古いまま動き続けることがない。
 */
export const WireCompareReason = z.enum([
  'b_not_requested',
  'b_same_as_a',
  'b_not_found',
  'b_media_unresolved',
  'a_media_unresolved',
])
export type WireCompareReason = z.infer<typeof WireCompareReason>

/** 拍の出どころの状態。「楽曲が無い」「解析が無い」「拍が 0 件」を混ぜない（L-015）。 */
export const WireCompareBeatState = z.enum(['available', 'no_beats', 'no_analysis', 'no_track'])
export type WireCompareBeatState = z.infer<typeof WireCompareBeatState>

export const WireComparedTake = z.object({
  takeId: TakeId,
  document: TimelineDocument,
})
export type WireComparedTake = z.infer<typeof WireComparedTake>

export const WireShotCompare = z.object({
  shot: z.object({
    startSec: Seconds,
    durationSec: Seconds,
    sourceInSec: Seconds,
  }),
  a: WireComparedTake,
  b: WireComparedTake.nullable(),
  beats: z.array(Seconds),
  /** 小節頭。**拍の部分集合とは限らない**（手で直した解析では拍の列に無い小節頭がありうる）。 */
  downbeats: z.array(Seconds),
  beatState: WireCompareBeatState,
  reason: WireCompareReason.nullable(),
})
export type WireShotCompare = z.infer<typeof WireShotCompare>

// --- 区間 ---

/** 比較する区間。Shot の開始と尺だけで決まる。 */
export type CompareSpan = {
  readonly startSec: number
  readonly durationSec: number
}

export const spanEndSec = (span: CompareSpan): number => span.startSec + span.durationSec

/** 区間の外へ出た位置を内側へ戻す。再生ヘッドの描画に使う。 */
export const clampToSpan = (sec: number, span: CompareSpan): number =>
  Math.min(Math.max(sec, span.startSec), spanEndSec(span))

/**
 * この Shot の区間に入る拍だけを選ぶ。
 *
 * **開始は含み、終了は含まない。** ちょうど終端にある拍は次の Shot のもので、
 * ここに出すと「隣の Shot の頭」を自分の拍として数えることになる。
 * 尺が 0 以下のときは 1 件も返さない（区間が無いのだから拍も無い）。
 */
export const beatsInShot = (
  beats: readonly number[],
  startSec: number,
  durationSec: number,
): readonly number[] => {
  if (durationSec <= 0) return []
  const endSec = startSec + durationSec
  return beats.filter((beat) => beat >= startSec && beat < endSec)
}

/**
 * 区間内の位置を目盛り上の百分率（0..100）へ。
 *
 * 尺が 0 以下なら割れないので 0 を返す。**区間の外はそのまま外の値を返す**
 * （呼び出し側が `clampToSpan` で戻すか、出さないかを決める）。
 */
export const spanPercent = (sec: number, span: CompareSpan): number =>
  span.durationSec <= 0 ? 0 : ((sec - span.startSec) / span.durationSec) * 100

/** 目盛りを押した割合（0..1）から秒へ。区間の外は押せないので内側へ丸める。 */
export const secAtSpanFraction = (fraction: number, span: CompareSpan): number =>
  clampToSpan(span.startSec + span.durationSec * fraction, span)

// --- 目盛りの目印 ---

export type BeatTick = {
  /** 絶対秒。`key` にもそのまま使える。 */
  readonly sec: number
  /** 目盛り上の位置（0..100）。 */
  readonly percent: number
  /** 区間の先頭の拍。数え始めが分かるよう少し強く出す。 */
  readonly isFirst: boolean
  /**
   * 小節頭。**拍の強弱の中で最も強い。**
   * ミュージックビデオのカットは小節頭に置くのが基本なので、
   * 普通の拍と同じ太さで出すと、狙うべき線が埋もれる。
   */
  readonly isDownbeat: boolean
}

/**
 * 小節頭かどうかの判定に使う許容差（秒）。
 *
 * **完全一致では判定できない。** `downbeats` は `beats` の部分集合とは限らず、
 * 解析器が別々に出した浮動小数なので、同じ拍でも下位の桁が食い違う。
 * 1 ミリ秒は 30fps の 1 フレーム（33ms）よりはるかに細かいので、
 * 隣の拍を巻き込むことはない。
 */
const DOWNBEAT_MATCH_SEC = 0.001

const isDownbeatAt = (sec: number, downbeats: readonly number[]): boolean =>
  downbeats.some((downbeat) => Math.abs(downbeat - sec) <= DOWNBEAT_MATCH_SEC)

/**
 * 区間の拍を目盛りの目印へ。**区間に入る拍だけ**を、押された順ではなく時間順に返す。
 * 小節頭は太さで区別する（`isDownbeat`）。
 */
export const beatTicks = (
  beats: readonly number[],
  span: CompareSpan,
  downbeats: readonly number[] = [],
): readonly BeatTick[] => {
  const inside = [...beatsInShot(beats, span.startSec, span.durationSec)].sort((a, b) => a - b)
  return inside.map((sec, index) => ({
    sec,
    percent: spanPercent(sec, span),
    isFirst: index === 0,
    isDownbeat: isDownbeatAt(sec, downbeats),
  }))
}

// --- 状態の説明 ---

export type CompareTone = 'ok' | 'warn' | 'error'

export type CompareNotice = {
  readonly tone: CompareTone
  readonly headline: string
  readonly detail: string
}

const COMPARE_NOTICES: Readonly<Record<WireCompareReason, CompareNotice>> = {
  b_not_requested: {
    tone: 'ok',
    headline: '比較する Take を選んでいません',
    detail:
      'Take を 1 本選ぶと、同じ拍の上で並べて見られます。いまは採用候補だけを大きく出しています。',
  },
  b_same_as_a: {
    tone: 'warn',
    headline: '同じ Take を 2 つ選んでいます',
    detail: '並べても同じ絵にしかなりません。別の Take を選んでください。',
  },
  b_not_found: {
    tone: 'warn',
    headline: '比較する Take が見つかりません',
    detail: 'この Shot の Take ではないか、すでに消えています。一覧から選び直してください。',
  },
  b_media_unresolved: {
    tone: 'error',
    headline: '比較する Take の素材を読み込めません',
    detail:
      'Take は残っていますが、素材が見つかりません。生成し直すか、別の Take を選んでください。',
  },
  a_media_unresolved: {
    tone: 'error',
    headline: '採用候補の素材を読み込めません',
    detail:
      '比較の土台になる絵が出せないため、並べても判断できません。生成し直すか、別の Take を選んでください。',
  },
}

/**
 * 比較の状態を画面の文言へ。
 *
 * **`reason` が null のときだけ「2 本並んでいる」と言える。** 「B が無い」と
 * 「B を読めていない」を同じ文にすると、待てば直るのか操作が要るのかが消える（L-015）。
 */
export const describeCompareState = (reason: WireCompareReason | null): CompareNotice | null =>
  reason === null ? null : COMPARE_NOTICES[reason]

const BEAT_NOTICES: Readonly<Record<Exclude<WireCompareBeatState, 'available'>, CompareNotice>> = {
  no_beats: {
    tone: 'warn',
    headline: '解析にビートが 1 件もありません',
    detail: '解析は読めています。目盛りには線が出ませんが、区間の繰り返しはそのまま使えます。',
  },
  no_analysis: {
    tone: 'warn',
    headline: 'この楽曲はまだ解析されていません',
    detail:
      '目盛りに拍の線が出ません。ストーリーボード画面から解析を流すと、拍の上で比べられるようになります。',
  },
  no_track: {
    tone: 'warn',
    headline: 'このプロジェクトに楽曲が登録されていません',
    detail:
      '拍の目盛りは出せません。音楽を登録して解析すると、曲のどこで何が起きるかで比べられます。',
  },
}

/**
 * 拍の状態を画面の文言へ。
 *
 * **区間に拍が 1 件も入らない場合も黙らせない。** 曲全体には拍があるのに
 * この Shot の区間に無いのは、区間が短すぎるか位置がずれているかで、
 * 「解析が無い」とは取るべき行動が違う。
 */
export const describeBeatState = (
  state: WireCompareBeatState,
  ticksInSpan: number,
): CompareNotice | null => {
  if (state !== 'available') return BEAT_NOTICES[state]
  if (ticksInSpan === 0) {
    return {
      tone: 'warn',
      headline: 'この区間には拍が 1 つも入っていません',
      detail: '曲の拍は読めています。Shot の位置か尺が拍から外れている可能性があります。',
    }
  }
  return null
}

/** 12px の文字の上で使うため `faint` は使わない（PHASE 5.9 の対応表）。 */
const TONE_CLASSES: Readonly<Record<CompareTone, string>> = {
  ok: 'text-muted',
  warn: 'text-warn',
  error: 'text-danger',
}

export const compareNoticeClassName = (tone: CompareTone): string => TONE_CLASSES[tone]

// --- 並べ方 ---

/**
 * B が無いときは A だけを大きく出す。
 * **「比較するものが無い」と「読めていない」を分ける**のは `describeCompareState` の仕事で、
 * ここは並べ方だけを決める。
 */
export const compareColumns = (hasB: boolean): 1 | 2 => (hasB ? 2 : 1)
