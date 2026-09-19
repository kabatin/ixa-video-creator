import type { ShotId } from '@ixa/domain'
import type { WireShot } from '@/lib/api-schemas'

/**
 * 一括操作の「選ぶ」「送ってよいか」「結果をどう読むか」を算出する。
 * **React を含まない純粋関数だけを置く。** 画面は返ってきたものを表示するだけにする。
 * 入力は一切変更せず、常に新しい値を返す。
 *
 * **サーバが決めることをここで決め直さない**（lessons L-016）。
 * 止めてよいのは「送る前に画面が確実に知っていること」だけ。
 * Take の本数・仕様が組めるか・予算・件数の上限はすべてサーバの持ち物で、
 * 画面は返ってきた `ok: false` の理由をそのまま出す。
 */

/** 一括で何をするか。判定も文言もこの 3 つで切り替える。 */
export type BulkOperation = 'generate' | 'select-take' | 'update'

/** 適格性・要約に必要な列だけ。画面は `WireShot` をそのまま渡せる。 */
export type BulkShot = Pick<WireShot, 'id' | 'code' | 'lockedAt' | 'selectedTakeId'>

/** コードを引くためだけの最小の形。 */
export type ShotRef = Pick<WireShot, 'id' | 'code'>

// --- 選択の状態 ---

/**
 * 選ばれている ShotId の集合。**必ず新しい Set を返す。**
 * 画面の state にそのまま置ける。
 */
export type ShotSelection = ReadonlySet<ShotId>

export const EMPTY_SELECTION: ShotSelection = new Set<ShotId>()

export const isSelected = (selection: ShotSelection, shotId: ShotId): boolean =>
  selection.has(shotId)

export const selectionCount = (selection: ShotSelection): number => selection.size

export const selectShot = (selection: ShotSelection, shotId: ShotId): ShotSelection =>
  selection.has(shotId) ? selection : new Set([...selection, shotId])

export const deselectShot = (selection: ShotSelection, shotId: ShotId): ShotSelection =>
  selection.has(shotId) ? new Set([...selection].filter((id) => id !== shotId)) : selection

export const toggleShot = (selection: ShotSelection, shotId: ShotId): ShotSelection =>
  selection.has(shotId) ? deselectShot(selection, shotId) : selectShot(selection, shotId)

export const clearSelection = (): ShotSelection => new Set<ShotId>()

/**
 * 全選択は**いま見えている一覧の中だけ**。
 *
 * 見えていない Shot を選択に残さないのは、`N 件を選択中` が画面に無いものまで
 * 数えてしまうと、利用者が何に効いたのか分からなくなるため。
 * 絞り込みを変えたら `pruneSelection` で同じ規則に戻す。
 */
export const selectAllVisible = (visibleIds: readonly ShotId[]): ShotSelection =>
  new Set(visibleIds)

/** 見えている範囲で反転する。見えていないものは選択に入れない。 */
export const invertSelection = (
  selection: ShotSelection,
  visibleIds: readonly ShotId[],
): ShotSelection => new Set(visibleIds.filter((id) => !selection.has(id)))

/** 絞り込みで消えた Shot を選択から落とす。一覧を差し替えたら必ず通すこと。 */
export const pruneSelection = (
  selection: ShotSelection,
  visibleIds: readonly ShotId[],
): ShotSelection => new Set(visibleIds.filter((id) => selection.has(id)))

/** 見出しのチェックボックスの状態。`partial` は indeterminate にあたる。 */
export type HeaderCheckboxState = 'none' | 'partial' | 'all'

export const headerCheckboxState = (
  selection: ShotSelection,
  visibleIds: readonly ShotId[],
): HeaderCheckboxState => {
  if (visibleIds.length === 0) return 'none'
  const selected = visibleIds.filter((id) => selection.has(id)).length
  if (selected === 0) return 'none'
  return selected === visibleIds.length ? 'all' : 'partial'
}

/**
 * 送る順を一覧の並びに固定する。
 * 集合の反復順に依存させると、同じ選択でも本文が変わり、結果の読み合わせができない。
 */
export const selectedShotIds = (
  selection: ShotSelection,
  visibleShots: readonly ShotRef[],
): readonly ShotId[] => visibleShots.filter((shot) => selection.has(shot.id)).map((shot) => shot.id)

// --- 適格性 ---

/**
 * 1 件ごとの判定。通ったときも `notice`（止めはしないが伝えるべきこと）を運ぶ。
 * 黙って通すと、上書きされたことに気づけない。
 */
export type ShotEligibility =
  | { readonly shotId: ShotId; readonly ok: true; readonly notice: string | null }
  | { readonly shotId: ShotId; readonly ok: false; readonly reason: string }

const LOCKED_REASON = 'ロック済みのため一括生成の対象にできません'
const OVERWRITE_NOTICE = '既に採用済みの Take があります。一括採用で上書きされます'

/**
 * 一括生成。**止めるのはロック済みだけ。**
 * 仕様が組めるか（Look・参照・場所が揃っているか）はサーバが判断する。
 * 画面が同じ判定を持つと必ずズレる。
 */
const generateEligibility = (shot: BulkShot): ShotEligibility =>
  shot.lockedAt === null
    ? { shotId: shot.id, ok: true, notice: null }
    : { shotId: shot.id, ok: false, reason: LOCKED_REASON }

/**
 * 一括採用。**画面は Take の本数を知らないので、できるかを判定しない。**
 * できない理由（Take が無い / `only` なのに複数ある）は API の結果で出す。
 * 既に採用済みのものだけ、上書きになることを注意として返す。
 */
const selectTakeEligibility = (shot: BulkShot): ShotEligibility => ({
  shotId: shot.id,
  ok: true,
  notice: shot.selectedTakeId === null ? null : OVERWRITE_NOTICE,
})

/** 一括変更に画面側の制限は無い。 */
const updateEligibility = (shot: BulkShot): ShotEligibility => ({
  shotId: shot.id,
  ok: true,
  notice: null,
})

export const eligibilityFor = (operation: BulkOperation, shot: BulkShot): ShotEligibility => {
  switch (operation) {
    case 'generate':
      return generateEligibility(shot)
    case 'select-take':
      return selectTakeEligibility(shot)
    case 'update':
      return updateEligibility(shot)
  }
}

/** 送る前に分かっていること。コードを添えて画面にそのまま出せる形にする。 */
export type BulkNote = {
  readonly shotId: ShotId
  readonly code: string
  readonly message: string
}

export type BulkPlan = {
  readonly operation: BulkOperation
  /** 実際に送る ShotId。一覧の並び順。 */
  readonly targetIds: readonly ShotId[]
  /** 送らないもの。理由を必ず持つ。 */
  readonly blocked: readonly BulkNote[]
  /** 送るが伝えるべきこと。 */
  readonly notices: readonly BulkNote[]
}

const MISSING_REASON = '一覧に見当たりません。絞り込みを外して選び直してください'

/**
 * 選択から「送るもの」と「送らないもの」を組み立てる。
 *
 * 選択にあるのに一覧に無い ShotId は、**黙って落とさず `blocked` に残す**。
 * 落とすと「27 件選んだのに 25 件しか送られない」が理由なしで起き、
 * 利用者は送られなかったことに気づけない（lessons L-015）。
 * 通常は `pruneSelection` で先に消えているので、ここに残るのは想定外の状態を表す。
 */
export const planBulkOperation = (
  operation: BulkOperation,
  selection: ShotSelection,
  visibleShots: readonly BulkShot[],
): BulkPlan => {
  const chosen = visibleShots.filter((shot) => selection.has(shot.id))
  const verdicts = chosen.map((shot) => ({ shot, verdict: eligibilityFor(operation, shot) }))
  const visibleIds = new Set(visibleShots.map((shot) => shot.id))
  const missing = [...selection].filter((id) => !visibleIds.has(id))

  return {
    operation,
    targetIds: verdicts.flatMap(({ shot, verdict }) => (verdict.ok ? [shot.id] : [])),
    blocked: [
      ...verdicts.flatMap(({ shot, verdict }) =>
        verdict.ok ? [] : [{ shotId: shot.id, code: shot.code, message: verdict.reason }],
      ),
      ...missing.map((shotId) => ({ shotId, code: shotId, message: MISSING_REASON })),
    ],
    notices: verdicts.flatMap(({ shot, verdict }) =>
      verdict.ok && verdict.notice !== null
        ? [{ shotId: shot.id, code: shot.code, message: verdict.notice }]
        : [],
    ),
  }
}

// --- 結果の要約 ---

/**
 * API が返す 1 件ぶんの結果のうち、要約が読む部分だけ。
 * 3 つの経路の `results` はすべてこの形に代入できる（`shot-bulk-api.ts` の Wire* を参照）。
 * **`ok: false` は必ず理由を持つ。** 理由の無い失敗を型として作れないようにしてある。
 */
export type BulkOutcome =
  | { readonly shotId: ShotId; readonly ok: true }
  | { readonly shotId: ShotId; readonly ok: false; readonly reason: string }

export type BulkSummary = {
  readonly operation: BulkOperation
  readonly totalCount: number
  readonly succeededCount: number
  readonly failedCount: number
  /** 成功した件だけを一覧の状態に反映するための集合。 */
  readonly succeededIds: ShotSelection
  /** 失敗ごとの `コード — 理由`。**理由を省かない**（lessons L-015）。 */
  readonly failures: readonly BulkNote[]
  readonly headline: string
  /** `headline` と失敗の行を連ねた全文。画面はこれを出せばよい。 */
  readonly text: string
}

type Wording = {
  readonly done: string
  readonly notDone: string
}

const WORDINGS: Readonly<Record<BulkOperation, Wording>> = {
  generate: { done: '生成に回しました', notDone: '生成に回していません' },
  'select-take': { done: '採用しました', notDone: '採用していません' },
  update: { done: '変更しました', notDone: '変更していません' },
}

const codeOf = (shots: readonly ShotRef[], shotId: ShotId): string =>
  shots.find((shot) => shot.id === shotId)?.code ?? shotId

const formatUsd = (usd: number): string => `$${usd.toFixed(2)}`

/** 見積は一括生成にだけ付く。渡されなければ何も書かない（0 と「不明」を混ぜない）。 */
const estimateSentence = (estimatedTotalUsd: number | null): string =>
  estimatedTotalUsd === null ? '' : `見積の合計は ${formatUsd(estimatedTotalUsd)} です。`

const headlineOf = (
  operation: BulkOperation,
  total: number,
  succeeded: number,
  estimatedTotalUsd: number | null,
): string => {
  const wording = WORDINGS[operation]
  if (total === 0) return '対象の Shot がありません。'
  if (succeeded === 0) return `${total} 件すべてが失敗しました。1 件も${wording.notDone}。`
  if (succeeded === total) {
    return `${total} 件すべてを${wording.done}。${estimateSentence(estimatedTotalUsd)}`.trimEnd()
  }
  return `${total} 件中 ${succeeded} 件を${wording.done}。${estimateSentence(estimatedTotalUsd)}`.trimEnd()
}

/**
 * 結果を画面に出す文にする。
 *
 * 一括操作は途中で止まらないので、**成功も失敗も同じ 1 つの結果に入って返る**。
 * 件数だけに畳むと何が失敗したか分からなくなるため、失敗は必ずコードと理由で並べる。
 * `shots` から `shotId` のコードを引く。引けなければ ID をそのまま出す
 * （他 Project の Shot が混ざった場合など、一覧に無い ID が返りうる）。
 */
export const summarizeBulkResult = (
  operation: BulkOperation,
  results: readonly BulkOutcome[],
  shots: readonly ShotRef[],
  estimatedTotalUsd: number | null = null,
): BulkSummary => {
  const succeeded = results.flatMap((result) => (result.ok ? [result.shotId] : []))
  const failures = results.flatMap((result) =>
    result.ok
      ? []
      : [{ shotId: result.shotId, code: codeOf(shots, result.shotId), message: result.reason }],
  )
  const headline = headlineOf(operation, results.length, succeeded.length, estimatedTotalUsd)
  const failureLines =
    failures.length === 0
      ? []
      : [`失敗 ${failures.length} 件:`, ...failures.map((f) => `  ${f.code} — ${f.message}`)]

  return {
    operation,
    totalCount: results.length,
    succeededCount: succeeded.length,
    failedCount: failures.length,
    succeededIds: new Set(succeeded),
    failures,
    headline,
    text: [headline, ...failureLines].join('\n'),
  }
}
