import type { ShotId } from '@ixa/domain'
import type { WireShotPoster } from '@/lib/shot-posters-api'

/**
 * サムネイルの判定（P60-3）。**部品は表示だけ**にし、選び方と言い換えはここに置く。
 *
 * 絵が出せないときは必ず理由を連れて回る。空枠を黙って並べると
 * 「まだ作っていない」と「作ったが読めなかった」が同じ見た目になる（L-015）。
 */

/** 1 枚の枠に渡す形。`url` が null のとき `reason` は必ず非 null。 */
export type PosterView = {
  readonly url: string | null
  readonly reason: string | null
}

/**
 * Shot の 1 枚。作っている最中か（待てば出るか。サムネに回る印を出す。制作者 2026-10-02）を添える。
 * 何を作っているかの文は `reason`（API の文）が言う。ここで理由の文を見て判定しない（書き写すとズレる）。
 */
export type ShotPosterCell = PosterView & { readonly pending: boolean }

/**
 * Shot の 1 枠。絵に加えて、最初のフレームが付いているか（流れの帯・説明も絵も無い Shot の確認）と、
 * 絵コンテの画像を作っているか（採用 Take があっても。一覧で絵と動画の作業中を分けて出す）。
 */
export type ShotPosterView = ShotPosterCell & { readonly hasStartFrame: boolean; readonly drawing: boolean }

export type ShotPosterMap = ReadonlyMap<ShotId, ShotPosterView>

/**
 * 「まだ取ってきていない」を表す理由。
 *
 * **「無い」と混ぜない**（L-021）。取得前の空欄に「Take がありません」と出すと、
 * 読み手は生成をやり直そうとする。実際には待てば絵が出る。
 */
export const NOT_FETCHED_REASON = 'not_fetched'

/** Shot が一覧に 1 件も無いとき。プロジェクトカードの表紙を選べない理由。 */
export const NO_SHOTS_REASON = 'no_shots'

const PENDING_POSTER: ShotPosterCell = { url: null, reason: NOT_FETCHED_REASON, pending: false }

/**
 * **画面が自分で作った理由だけ**をここで言い換える。
 *
 * API（`apps/api/src/routes/shot-posters.ts` の `SHOT_POSTER_REASON`）は
 * 既に読める日本語の文を返す。**同じ文をここに書き写さない。**
 * 書き写せば必ずズレ、API が文を直しても画面は古い文を出し続ける。
 * 知らない理由はそのまま出す（落とさない）。
 */
const MISSING_POSTER_TEXT: Readonly<Record<string, string>> = {
  [NOT_FETCHED_REASON]: 'サムネイルを読み込み中',
  [NO_SHOTS_REASON]: 'Shot がありません',
}

/** 取り直すまでの間隔。サムネイルは数秒でできる。 */
export const POSTER_RETRY_MS = 3_000

/** 続けて取り直す上限（約 2 分）。出ないまま回り続けない。 */
export const MAX_POSTER_RETRIES = 40

/**
 * 取り直すなら何ミリ秒後か。取り直さないなら null（2026-09-27）。
 *
 * **サムネイルを作っている行（`pending`）があるときだけ**取り直す。以前は生成が終わった
 * 瞬間に 1 回取るだけで、サムネイルがその後にできても出ず、読み直すまで出なかった。
 * Take が無いなど、待っても出ない行では取り直さない。
 */
export const posterRetryDelayMs = (
  list: readonly WireShotPoster[],
  attempt: number,
): number | null =>
  attempt < MAX_POSTER_RETRIES && list.some((entry) => entry.pending) ? POSTER_RETRY_MS : null

/**
 * 読めなかった絵があったときに一覧を引き直すまでの間（ミリ秒）。署名付き URL の期限（5 分）より十分短い。
 * 取ったばかりの一覧で読めないなら、期限ではなく絵そのものが無い。引き直しても直らないので頼まない（回り続けない）。
 */
export const POSTER_RENEW_AFTER_MS = 60_000

/** 一覧を引き直すか。`fetchedAtMs` は最後に取れた時刻。まだ取れていなければ null（取りにいっている最中）。 */
export const postersStale = (fetchedAtMs: number | null, nowMs: number): boolean =>
  fetchedAtMs !== null && nowMs - fetchedAtMs > POSTER_RENEW_AFTER_MS

/** 行から Shot ごとに引ける形へ直す。同じ Shot が 2 度来たら後勝ち（API は 1 件ずつ返す）。 */
export const posterByShotId = (list: readonly WireShotPoster[]): ShotPosterMap =>
  new Map(
    list.map((entry) => [
      entry.shotId,
      {
        url: entry.thumbnailUrl,
        reason: entry.reason,
        hasStartFrame: entry.hasStartFrame,
        pending: entry.pending,
        drawing: entry.drawing,
      },
    ]),
  )

/**
 * 最初のフレームが付いているか。**まだ引けていなければ null**（「無い」と読み替えない。L-021）。
 */
/** 絵（最初のフレーム）を作っている Shot の数。順番を待っている絵も含む（制作者 2026-10-04）。 */
export const countDrawing = (posters: ShotPosterMap): number =>
  [...posters.values()].filter((poster) => poster.drawing).length

export const startFrameKnownFor = (posters: ShotPosterMap, shotId: ShotId): boolean | null =>
  posters.get(shotId)?.hasStartFrame ?? null

/**
 * まだ引けていない Shot の分。
 * Map に無いことを「絵が無い」と読み替えない。SSE で増えた直後の Shot がこれに当たる。
 */
export const posterViewFor = (posters: ShotPosterMap, shotId: ShotId): ShotPosterCell =>
  posters.get(shotId) ?? PENDING_POSTER

/**
 * 空枠に書く短い文。
 *
 * `reason` が null で来るのは本来あり得ない（スキーマが禁じている）。
 * それでも来たときに黙って空欄にすると、検査が通ったように見える。
 */
export const describeMissingPoster = (reason: string | null): string => {
  if (reason === null) return '理由が分かりません'
  const trimmed = reason.trim()
  if (trimmed === '') return '理由が分かりません'
  return MISSING_POSTER_TEXT[trimmed] ?? trimmed
}

/**
 * プロジェクトカードの表紙。**サムネイルがある先頭の Shot**を選ぶ。
 *
 * 1 枚も無いときは理由を返す。先頭の Shot の理由をそのまま使う
 * （「まだ 1 本も生成していない」と「生成したが失敗した」で次の行動が変わる）。
 */
export const pickProjectCover = (posters: readonly WireShotPoster[]): PosterView => {
  const found = posters.find((entry) => entry.thumbnailUrl !== null)
  if (found !== undefined) return { url: found.thumbnailUrl, reason: null }

  const first = posters[0]
  if (first === undefined) return { url: null, reason: NO_SHOTS_REASON }
  return { url: null, reason: first.reason }
}
