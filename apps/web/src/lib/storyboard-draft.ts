import type { ShotId } from '@ixa/domain'
import type {
  WireStoryboardDraftItem,
  WireStoryboardDraftRun,
} from '@/lib/storyboard-draft-api'

/**
 * 絵コンテ下書きの表示ロジック（P63-4）。**判定と言葉はここだけが持つ。**
 *
 * この画面でいちばん間違えやすいのは、**押していない Shot まで採用されること**。
 * 本制作の Shot の一部は既に Take を採用済みで、説明が黙って書き換わると
 * 生成済みの Take と食い違ったまま誰も気付かない。
 * そのため選択は**空から始まり**、採用済みの行は選び直せない。
 */

/** 画面が知っている「いまの Shot」。下書きと突き合わせるのに必要な分だけ。 */
export type CurrentShot = {
  readonly id: ShotId
  readonly code: string
  readonly description: string
  readonly mood: string | null
}

/** 採否の状態。**`undecided` は「不採用」ではない**（lessons L-021）。 */
export type DraftDecision = 'adopted' | 'undecided'

export type DraftRow = {
  readonly shotId: ShotId
  readonly code: string
  /** いまの説明。空なら「（未記入）」と出す。空欄のままにしない。 */
  readonly currentDescription: string
  readonly currentMood: string | null
  readonly proposedDescription: string
  readonly proposedMood: string | null
  /** なぜこの絵か。**必ず出す。** これが無いと採否を決められない。 */
  readonly reason: string
  readonly decision: DraftDecision
  /** 採用済みの行は選び直せない（案は追記のみで、採用は取り消せない）。 */
  readonly selectable: boolean
  /** いまの説明と案が同じなら、採用しても何も変わらない。 */
  readonly unchanged: boolean
}

export const EMPTY_DESCRIPTION_LABEL = '（未記入）'
export const EMPTY_MOOD_LABEL = '（未設定）'

export const describeCurrent = (description: string): string =>
  description.trim() === '' ? EMPTY_DESCRIPTION_LABEL : description

export const describeMood = (mood: string | null): string =>
  mood === null || mood.trim() === '' ? EMPTY_MOOD_LABEL : mood

/**
 * 案と「いまの Shot」を突き合わせて行を作る。
 *
 * **Shot の並びを正とする。** 案の順番ではなく Shot の順番で並べないと、
 * 人が絵コンテとして読み下せない。案の無い Shot は行にしない
 * （案が無いことは採否の対象が無いということで、空の行を出す意味は無い）。
 */
export const buildDraftRows = (
  items: readonly WireStoryboardDraftItem[],
  shots: readonly CurrentShot[],
): readonly DraftRow[] => {
  const byShot = new Map(items.map((item) => [item.shotId, item] as const))

  return shots.flatMap((shot) => {
    const item = byShot.get(shot.id)
    if (item === undefined) return []

    const adopted = item.adoptedAt !== null
    return [
      {
        shotId: shot.id,
        code: shot.code,
        currentDescription: shot.description,
        currentMood: shot.mood,
        proposedDescription: item.description,
        proposedMood: item.mood,
        reason: item.reason,
        decision: adopted ? ('adopted' as const) : ('undecided' as const),
        selectable: !adopted,
        unchanged: shot.description === item.description && shot.mood === item.mood,
      },
    ]
  })
}

/**
 * 案が用意されているのに、画面が知らない Shot を指している数。
 *
 * **黙って落とさない。** 落とすと「27 件の案を作ったのに 18 行しか出ない」が
 * 不具合と区別できなくなる（lessons L-013）。
 */
export const countUnmatchedItems = (
  items: readonly WireStoryboardDraftItem[],
  shots: readonly CurrentShot[],
): number => {
  const known = new Set(shots.map((shot) => shot.id))
  return items.filter((item) => !known.has(item.shotId)).length
}

/** 選択の切り替え。**新しい集合を返す**（破壊的変更をしない）。 */
export const toggleSelection = (
  selected: ReadonlySet<ShotId>,
  shotId: ShotId,
): ReadonlySet<ShotId> => {
  const next = new Set(selected)
  if (next.has(shotId)) next.delete(shotId)
  else next.add(shotId)
  return next
}

/** まだ決めていない行だけを全部選ぶ。**採用済みは触らない。** */
export const selectAllSelectable = (rows: readonly DraftRow[]): ReadonlySet<ShotId> =>
  new Set(rows.filter((row) => row.selectable).map((row) => row.shotId))

export const clearSelection = (): ReadonlySet<ShotId> => new Set()

/** 実際に採用を送る Shot。**選択されていて、かつまだ決めていない行だけ。** */
export const adoptableShotIds = (
  rows: readonly DraftRow[],
  selected: ReadonlySet<ShotId>,
): readonly ShotId[] =>
  rows.filter((row) => row.selectable && selected.has(row.shotId)).map((row) => row.shotId)

export type DraftSummary = {
  readonly headline: string
  /** 失敗やズレを伝える 1 行。無ければ null。 */
  readonly notice: string | null
  /** 押せるかどうか。0 件選択では押させない。 */
  readonly canAdopt: boolean
  readonly adoptLabel: string
}

const RUNNING_HEADLINE = '下書きを作っています'

/**
 * 「実行中」のまま、ここを超えたら止まっている疑いを出す。
 *
 * **プロセスが死ぬと `running` は永久に残る。** それを黙って「実行中」と見せ続けると、
 * 待てば終わると誤解させる。27 件ぶんの下書きは数分で終わるので、
 * 10 分を超えたら待っても終わらないと考えてよい。
 */
export const STALLED_AFTER_MS = 10 * 60 * 1000

const MINUTE_MS = 60 * 1000

/**
 * 実行中の run に添える 1 行。**いつ始まったかを必ず出す**（L-015）。
 * 経過が読めない時刻なら、読めないことをそのまま書く。0 分に畳まない。
 */
export const describeRunning = (startedAt: string, now: Date): string => {
  const started = new Date(startedAt).getTime()
  if (Number.isNaN(started)) return '開始時刻が読めません'

  const elapsedMs = now.getTime() - started
  const minutes = Math.floor(elapsedMs / MINUTE_MS)
  const since = minutes < 1 ? 'さきほど' : `${String(minutes)} 分前`

  return elapsedMs >= STALLED_AFTER_MS
    ? `${since}に始まったまま終わっていません。途中で止まった可能性があります`
    : `${since}に始まりました`
}

/**
 * 見出しと注意書き。**件数を必ず出す。**
 * 色だけでは全体像が掴めない（P63-1 で拍ズレの数を出すのと同じ理由）。
 */
export const buildDraftSummary = (input: {
  readonly run: WireStoryboardDraftRun | null
  readonly rows: readonly DraftRow[]
  readonly selected: ReadonlySet<ShotId>
  readonly unmatchedCount: number
  /** 「実行中」が何分続いているかを出すための今の時刻。**既定値を持たせない**（純関数のまま保つ）。 */
  readonly now: Date
}): DraftSummary => {
  const { run, rows, selected, unmatchedCount, now } = input

  if (run === null) {
    return {
      headline: 'まだ下書きしていません',
      notice: null,
      canAdopt: false,
      adoptLabel: '採用する',
    }
  }

  if (run.status === 'failed') {
    return {
      headline: '下書きに失敗しました',
      // 理由を必ず出す。握り潰すと、押した人には何も起きなかったように見える。
      notice:
        run.error === null
          ? '理由が記録されていません'
          : `${run.error.message}（${run.error.code}）`,
      canAdopt: false,
      adoptLabel: '採用する',
    }
  }

  if (run.status !== 'done') {
    return {
      headline: RUNNING_HEADLINE,
      // 開始時刻を必ず添える。止まったまま残った run を「実行中」と見せ続けない。
      notice: describeRunning(run.createdAt, now),
      canAdopt: false,
      adoptLabel: '採用する',
    }
  }

  const adoptable = adoptableShotIds(rows, selected)
  const adoptedCount = rows.filter((row) => row.decision === 'adopted').length

  return {
    headline: `${String(rows.length)} 件の案のうち ${String(adoptedCount)} 件を採用済み`,
    notice:
      unmatchedCount === 0
        ? null
        : `${String(unmatchedCount)} 件の案は、この画面が知らない Shot に対するものです`,
    canAdopt: adoptable.length > 0,
    adoptLabel:
      adoptable.length === 0
        ? '採用する'
        : `選んだ ${String(adoptable.length)} 件を採用する`,
  }
}
