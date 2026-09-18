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

export type ShotPosterMap = ReadonlyMap<ShotId, PosterView>

/**
 * 「まだ取ってきていない」を表す理由。
 *
 * **「無い」と混ぜない**（L-021）。取得前の空欄に「Take がありません」と出すと、
 * 読み手は生成をやり直そうとする。実際には待てば絵が出る。
 */
export const NOT_FETCHED_REASON = 'not_fetched'

/** Shot が一覧に 1 件も無いとき。プロジェクトカードの表紙を選べない理由。 */
export const NO_SHOTS_REASON = 'no_shots'

const PENDING_POSTER: PosterView = { url: null, reason: NOT_FETCHED_REASON }

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

/** 行から Shot ごとに引ける形へ直す。同じ Shot が 2 度来たら後勝ち（API は 1 件ずつ返す）。 */
export const posterByShotId = (list: readonly WireShotPoster[]): ShotPosterMap =>
  new Map(list.map((entry) => [entry.shotId, { url: entry.thumbnailUrl, reason: entry.reason }]))

/**
 * まだ引けていない Shot の分。
 * Map に無いことを「絵が無い」と読み替えない。SSE で増えた直後の Shot がこれに当たる。
 */
export const posterViewFor = (posters: ShotPosterMap, shotId: ShotId): PosterView =>
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
