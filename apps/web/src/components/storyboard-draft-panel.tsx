'use client'

import type { ProjectId, ShotId } from '@ixa/domain'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useNow } from '@/components/workbench/use-active-generations'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { formatElapsed } from '@/lib/format-time'
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
  /** CUT を押したらその Shot を選ぶ（ワークベンチ）。 */
  readonly onSelectShot?: (shotId: ShotId) => void
}

/** 行の状態を表す色。**役割の名前だけ**を使う（`design-tokens.test.ts`）。 */
const DECISION_CLASSES = {
  adopted: 'text-ok',
  undecided: 'text-muted',
} as const

/**
 * 1 行 1 Shot（UI-WORKBENCH-2 §6）。**「いまの説明」と「案」を横に並べて見比べる。**
 * 以前は 1 件ずつ大きなカードで、27 件を見比べられなかった。
 * なぜこの絵かは案の下に小さく出す（採否の根拠なので省かない）。同じ内容の行は薄くする。
 */
const DraftRowView = ({
  row,
  checked,
  locked,
  onToggle,
  onSelectShot,
}: {
  readonly row: DraftRow
  readonly checked: boolean
  /** 作り直している間。案が入れ替わるので選ばせない。 */
  readonly locked: boolean
  readonly onToggle: (shotId: ShotId) => void
  readonly onSelectShot?: (shotId: ShotId) => void
}) => (
  <tr
    className={`border-t border-line align-top ${row.unchanged ? 'opacity-60' : ''} ${checked ? 'bg-info/10' : ''}`}
  >
    <td className="px-1.5 py-1">
      <input
        type="checkbox"
        className="mt-0.5 h-3.5 w-3.5"
        checked={checked}
        disabled={!row.selectable || locked}
        onChange={() => {
          onToggle(row.shotId)
        }}
        aria-label={`${row.code} の案を採用する`}
      />
    </td>
    <th scope="row" className="px-1.5 py-1 text-left">
      <button
        type="button"
        onClick={() => onSelectShot?.(row.shotId)}
        className="whitespace-nowrap text-sm font-semibold text-text hover:underline"
      >
        {row.code}
      </button>
    </th>
    <td className="px-1.5 py-1 text-sm text-text">
      {describeCurrent(row.currentDescription)}
      <span className="block text-xs text-muted">雰囲気: {describeMood(row.currentMood)}</span>
    </td>
    <td className={`px-1.5 py-1 text-sm ${row.unchanged ? 'text-text' : 'text-text'}`}>
      <span className={row.unchanged ? '' : 'rounded bg-accent/10 px-0.5'}>
        {row.proposedDescription}
      </span>
      <span className="block text-xs text-muted">雰囲気: {describeMood(row.proposedMood)}</span>
      <span className="mt-0.5 block text-xs text-muted">なぜこの絵か: {row.reason}</span>
      {row.unchanged ? (
        <span className="block text-xs text-muted">いまの説明と同じ内容です</span>
      ) : null}
    </td>
    <td className={`whitespace-nowrap px-1.5 py-1 text-xs ${DECISION_CLASSES[row.decision]}`}>
      {row.decision === 'adopted' ? '採用済み' : 'まだ決めていません'}
    </td>
  </tr>
)

export const StoryboardDraftPanel = ({
  projectId,
  shots,
  initialRun = null,
  initialItems = [],
  preloaded = false,
  onAdopted,
  api,
  onSelectShot,
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
  /**
   * 作り直し始めた時刻（ms）。作っていなければ null。**作っていることを画面に出す**
   * （制作者 2026-10-02「ボタン押せなくなってなんでだろ」「案が変わってたけど気付きづらかった」）。
   */
  const [drafting, setDrafting] = useState<number | null>(null)
  /** 届いた案の件数。次に作り直すか採用するまで「新しい案が届きました」と出す。 */
  const [arrived, setArrived] = useState<number | null>(null)
  const now = useNow(drafting !== null)
  /** 作っている間も、採用している間も、ほかの操作は止める。 */
  const working = busy || drafting !== null
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
    setDrafting(Date.now())
    setArrived(null)
    setError(null)
    client
      .createDraft(projectId)
      .then((result) => {
        setRun(result.run)
        setItems(result.items)
        // 新しい案が来たら選択はやり直す。前の選択を引き継がない。
        setSelected(clearSelection())
        setArrived(result.items.length)
      })
      .catch((cause: unknown) => {
        // 握り潰さない。読めなかったことを画面に出す（規約 5 / lessons L-015）。
        setError(describeError(cause))
      })
      .finally(() => {
        setDrafting(null)
      })
  }

  const onAdopt = () => {
    if (run === null) return
    const shotIds = adoptableShotIds(rows, selected)
    if (shotIds.length === 0) return

    setBusy(true)
    setArrived(null)
    setError(null)
    client
      .adopt(projectId, run.id, shotIds)
      .then((result) => {
        const adoptedById = new Map(result.adopted.map((item) => [item.id, item] as const))
        setItems((previous) => previous.map((item) => adoptedById.get(item.id) ?? item))

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
    <section aria-label="絵コンテの下書き">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs text-muted">{summary.headline}</p>
      </div>

      {/* **「作る」と「採用する」を別の操作にする。** 作っただけでは Shot は変わらない。 */}
      <p className="mt-1 text-xs text-muted">
        下書きは Shot を書き換えません。採用した Shot だけが変わります。
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onDraft} disabled={working || loading}>
          {drafting !== null ? '作っています…' : run === null ? '下書きする' : '作り直す'}
        </Button>
        <Button
          size="sm"
          onClick={() => {
            setSelected(selectAllSelectable(rows))
          }}
          disabled={working || rows.length === 0}
        >
          まだ決めていない案をすべて選ぶ
        </Button>
        <Button
          size="sm"
          onClick={() => {
            setSelected(clearSelection())
          }}
          disabled={working || selected.size === 0}
        >
          選択を外す
        </Button>
        <Button size="sm" tone="primary" onClick={onAdopt} disabled={working || !summary.canAdopt}>
          {summary.adoptLabel}
        </Button>
      </div>

      {drafting !== null && (
        <p
          role="status"
          aria-label="絵コンテの案を作っています"
          className="mt-2 rounded border border-info/40 bg-info/10 px-2 py-1 text-sm text-text"
        >
          <span aria-hidden="true" className="mr-1 inline-block animate-pulse text-info">
            ●
          </span>
          AI が絵コンテの案を作っています
          {/* 毎秒読み上げない（経過は目で見るためのもの）。 */}
          <span aria-hidden="true" className="tabular-nums">{`（${formatElapsed((now - drafting) / 1000)} 経過。数分かかることがあります）`}</span>
          。終わると下の案が入れ替わります。
        </p>
      )}

      {arrived !== null && drafting === null && (
        <p role="status" className="mt-2 text-sm text-ok">
          {`新しい案が届きました（${String(arrived)} 件）。前に選んでいたものは外しました。`}
        </p>
      )}

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
        <table
          aria-busy={drafting !== null}
          className={`mt-2 w-full border-collapse text-left ${drafting !== null ? 'opacity-50' : ''}`}
        >
          <caption className="sr-only">絵コンテの案</caption>
          <thead className="sticky top-0 bg-surface-2 text-xs text-muted">
            <tr className="h-6">
              <th scope="col" className="w-6 px-1.5">
                <span className="sr-only">採用する</span>
              </th>
              <th scope="col" className="px-1.5">
                CUT
              </th>
              <th scope="col" className="w-2/5 px-1.5">
                いまの説明
              </th>
              <th scope="col" className="w-2/5 px-1.5">
                案
              </th>
              <th scope="col" className="px-1.5">
                状態
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <DraftRowView
                key={row.shotId}
                row={row}
                checked={selected.has(row.shotId)}
                locked={drafting !== null}
                onToggle={(shotId) => {
                  setSelected((previous) => toggleSelection(previous, shotId))
                }}
                onSelectShot={onSelectShot}
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
