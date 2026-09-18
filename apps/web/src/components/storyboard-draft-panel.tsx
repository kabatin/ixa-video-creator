'use client'

import type { ProjectId, ShotId } from '@ixa/domain'
import { useEffect, useMemo, useState } from 'react'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { createRequester } from '@/lib/requester'
import {
  adoptableShotIds,
  buildDraftRows,
  buildDraftSummary,
  clearSelection,
  countUnmatchedItems,
  describeCurrent,
  describeMood,
  selectAllSelectable,
  toggleSelection,
  type CurrentShot,
  type DraftRow,
} from '@/lib/storyboard-draft'
import {
  createStoryboardDraftApi,
  type StoryboardDraftApi,
  type WireAdoptedShot,
  type WireStoryboardDraftItem,
  type WireStoryboardDraftRun,
} from '@/lib/storyboard-draft-api'

/**
 * 絵コンテを LLM に一括で下書きさせ、**Shot ごとに人が採否を決める**（P63-4）。
 *
 * **下書きは Shot を書き換えない。** 書き換わるのは「採用する」を押したときの、
 * 選んだ Shot だけ。本制作の Shot の一部は既に Take を採用済みで、
 * 説明が黙って変わると生成済みの Take と食い違ったまま誰も気付かない。
 *
 * そのため選択は**空から始まる**。全選択は用意するが、押すのは人の操作。
 * 判定と言葉は `lib/storyboard-draft.ts` が持つ。ここは描くだけ。
 */

export type StoryboardDraftPanelProps = {
  readonly projectId: ProjectId
  /** いまの Shot。**並びの正はこちら。** 「いまの説明」もここから出す。 */
  readonly shots: readonly CurrentShot[]
  /**
   * サーバで先に読めていれば渡す。渡されなければ**開いたときに自分で読む。**
   * 読まないと、27 件ぶんを数分待って作った案が再読み込みで消えたように見える。
   */
  readonly initialRun?: WireStoryboardDraftRun | null
  readonly initialItems?: readonly WireStoryboardDraftItem[]
  /** 先に読めている場合は true にして、開いたときの読み込みを止める。 */
  readonly preloaded?: boolean
  /**
   * 採用で Shot が変わったことを親へ知らせる。
   * **この部品の中だけで完結させない。** 同じ画面の別の場所（一覧・タイムライン）が
   * 古い説明を出し続けると、どちらが本当か分からなくなる。
   */
  readonly onAdopted?: (shots: readonly WireAdoptedShot[]) => void
  /** テストから差し替えるための注入口。 */
  readonly api?: StoryboardDraftApi
}

/** 行の状態を表す色。**役割の名前だけ**を使う（`design-tokens.test.ts`）。 */
const DECISION_CLASSES = {
  adopted: 'text-ok',
  undecided: 'text-muted',
} as const

const DraftRowView = ({
  row,
  checked,
  onToggle,
}: {
  readonly row: DraftRow
  readonly checked: boolean
  readonly onToggle: (shotId: ShotId) => void
}) => (
  <li className="rounded-md border border-line bg-surface-2 p-3">
    <div className="flex items-start gap-3">
      <input
        type="checkbox"
        className="mt-1"
        checked={checked}
        disabled={!row.selectable}
        onChange={() => {
          onToggle(row.shotId)
        }}
        aria-label={`${row.code} の案を採用する`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-text">{row.code}</p>
          <p className={`text-xs ${DECISION_CLASSES[row.decision]}`}>
            {row.decision === 'adopted' ? '採用済み' : 'まだ決めていません'}
          </p>
        </div>

        {/*
          **「いまの説明」と「案」を必ず並べる。** 案だけを見せると、
          採用によって何が変わるのかが分からないまま押すことになる。
        */}
        <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted">いまの説明</dt>
            <dd className="text-text">{describeCurrent(row.currentDescription)}</dd>
            <dd className="text-xs text-muted">雰囲気: {describeMood(row.currentMood)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">案</dt>
            <dd className="text-text">{row.proposedDescription}</dd>
            <dd className="text-xs text-muted">雰囲気: {describeMood(row.proposedMood)}</dd>
          </div>
        </dl>

        {/* なぜこの絵か。**案と同じ重みで出す。** */}
        <p className="mt-2 text-sm text-muted">
          <span className="text-xs">なぜこの絵か: </span>
          {row.reason}
        </p>

        {row.unchanged ? (
          <p className="mt-1 text-xs text-muted">いまの説明と同じ内容です</p>
        ) : null}
      </div>
    </div>
  </li>
)

export const StoryboardDraftPanel = ({
  projectId,
  shots,
  initialRun = null,
  initialItems = [],
  preloaded = false,
  onAdopted,
  api,
}: StoryboardDraftPanelProps) => {
  const client = useMemo(
    () => api ?? createStoryboardDraftApi(createRequester(resolveApiBaseUrl())),
    [api],
  )

  const [run, setRun] = useState<WireStoryboardDraftRun | null>(initialRun)
  const [items, setItems] = useState<readonly WireStoryboardDraftItem[]>(initialItems)
  const [current, setCurrent] = useState<readonly CurrentShot[]>(shots)
  // **空から始まる。** 既定で 1 件も選ばれていない。
  const [selected, setSelected] = useState<ReadonlySet<ShotId>>(clearSelection())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 開いたときの読み込みが終わっていない間。**「案なし」と見分ける。** */
  const [loading, setLoading] = useState(!preloaded && initialRun === null)

  /**
   * 開いたときに保存済みの下書きを読む。
   * **これが無いと、画面を開き直すだけで案が消えたように見える。**
   */
  useEffect(() => {
    if (preloaded || initialRun !== null) return
    let cancelled = false

    client
      .getLatestDraft(projectId)
      .then((latest) => {
        if (cancelled) return
        setRun(latest.run)
        setItems(latest.items)
      })
      .catch((cause: unknown) => {
        // 握り潰さない。読めなかったことを画面に出す（規約 5 / lessons L-015）。
        if (!cancelled) setError(describeError(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [client, projectId, preloaded, initialRun])

  const rows = buildDraftRows(items, current)
  const summary = buildDraftSummary({
    run,
    rows,
    selected,
    unmatchedCount: countUnmatchedItems(items, current),
    now: new Date(),
  })

  const onDraft = () => {
    setBusy(true)
    setError(null)
    client
      .createDraft(projectId)
      .then((result) => {
        setRun(result.run)
        setItems(result.items)
        // 新しい案が来たら選択はやり直す。前の選択を引き継がない。
        setSelected(clearSelection())
      })
      .catch((cause: unknown) => {
        // 握り潰さない。読めなかったことを画面に出す（規約 5 / lessons L-015）。
        setError(describeError(cause))
      })
      .finally(() => {
        setBusy(false)
      })
  }

  const onAdopt = () => {
    if (run === null) return
    const shotIds = adoptableShotIds(rows, selected)
    if (shotIds.length === 0) return

    setBusy(true)
    setError(null)
    client
      .adopt(projectId, run.id, shotIds)
      .then((result) => {
        const adoptedById = new Map(result.adopted.map((item) => [item.id, item] as const))
        setItems((previous) =>
          previous.map((item) => adoptedById.get(item.id) ?? item),
        )

        // 返ってきた Shot で「いまの説明」を差し替える。**他の Shot は触らない。**
        const updatedById = new Map(result.shots.map((shot) => [shot.id, shot] as const))
        setCurrent((previous) =>
          previous.map((shot) => {
            const updated = updatedById.get(shot.id)
            return updated === undefined
              ? shot
              : { ...shot, description: updated.description, mood: updated.mood }
          }),
        )
        setSelected(clearSelection())
        onAdopted?.(result.shots)
      })
      .catch((cause: unknown) => {
        setError(describeError(cause))
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <section className="rounded-lg border border-line bg-surface p-4" aria-label="絵コンテの下書き">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-text">絵コンテの下書き</h2>
        <p className="text-xs text-muted">{summary.headline}</p>
      </div>

      {/* **「作る」と「採用する」を別の操作にする。** 作っただけでは Shot は変わらない。 */}
      <p className="mt-1 text-xs text-muted">
        下書きは Shot を書き換えません。採用した Shot だけが変わります。
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-sm text-text disabled:opacity-50"
          onClick={onDraft}
          disabled={busy || loading}
        >
          {run === null ? '下書きする' : '作り直す'}
        </button>
        <button
          type="button"
          className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-sm text-text disabled:opacity-50"
          onClick={() => {
            setSelected(selectAllSelectable(rows))
          }}
          disabled={busy || rows.length === 0}
        >
          まだ決めていない案をすべて選ぶ
        </button>
        <button
          type="button"
          className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-sm text-text disabled:opacity-50"
          onClick={() => {
            setSelected(clearSelection())
          }}
          disabled={busy || selected.size === 0}
        >
          選択を外す
        </button>
        <button
          type="button"
          className="rounded-md bg-accent px-3 py-1.5 text-sm text-accent-fg disabled:opacity-50"
          onClick={onAdopt}
          disabled={busy || !summary.canAdopt}
        >
          {summary.adoptLabel}
        </button>
      </div>

      {summary.notice === null ? null : (
        <p role="alert" className="mt-2 text-sm text-warn">
          {summary.notice}
        </p>
      )}

      {error === null ? null : (
        <p role="alert" className="mt-2 text-sm text-danger">
          下書きに失敗しました（{error}）
        </p>
      )}

      {loading ? (
        // **「読み込み中」と「案なし」を分ける。** 混ぜると、あるはずの案を無いと読ませる。
        <p className="mt-3 text-sm text-muted">読み込み中です</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted">まだ案がありません</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {rows.map((row) => (
            <DraftRowView
              key={row.shotId}
              row={row}
              checked={selected.has(row.shotId)}
              onToggle={(shotId) => {
                setSelected((previous) => toggleSelection(previous, shotId))
              }}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
