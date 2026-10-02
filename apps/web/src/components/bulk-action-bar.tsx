'use client'

import { useId, useState, type KeyboardEvent } from 'react'
import {
  BulkGenerateForm,
  BulkSelectTakesForm,
  BulkUpdateForm,
  type BulkGenerateInput,
  type BulkModelOption,
  type BulkSelectOption,
  type BulkTakeRule,
  type BulkUpdatePatch,
} from '@/components/bulk-action-forms'
import { Button } from '@/components/ui/button'
import { BulkDrawForm } from '@/components/bulk-draw-form'
import { ProgressDialog } from '@/components/ui/progress-dialog'
import type { BulkProgress } from '@/components/workbench/use-bulk-actions'
import { WORDING } from '@/lib/wording'

/**
 * 選ぶと画面の下に貼り付く操作バー（P58-4）。
 *
 * 制作者は 27 件の Shot に対して生成の依頼を 27 回、採用を 27 回した。
 * 一覧で選んで、ここで 1 回で済ませる。
 *
 * **状態も API 呼び出しもここには無い。** 選択は一覧が持ち、送信は配線側が行う。
 * この部品は「何件選ばれているか」と「結果の文」を受け取って出すだけにする。
 *
 * 3 つの入力の中身は `bulk-action-forms.tsx`。**同時に開くのは 1 つ。**
 */

export { buildBulkPatch, bulkPatchError, hasBulkPatch } from '@/components/bulk-action-forms'
export type {
  BulkGenerateInput,
  BulkModelOption,
  BulkSelectOption,
  BulkTakeRule,
  BulkUpdatePatch,
} from '@/components/bulk-action-forms'

type PanelKey = 'generate' | 'selectTakes' | 'update' | 'draw'

const PANEL_LABELS: Readonly<Record<PanelKey, string>> = {
  generate: '一括生成',
  selectTakes: '一括採用',
  update: '一括で変える',
  draw: '絵コンテの画像',
}

const PANEL_ORDER: readonly PanelKey[] = ['generate', 'selectTakes', 'update', 'draw']

/** 一括の結果。**1 件ずつの失敗を畳まない**（lessons L-015）。要約は呼び出し側が作る。 */
export type BulkOutcome = {
  readonly summary: string
  readonly failures: readonly string[]
}

export type BulkActionBarProps = {
  readonly selectedCount: number
  /** 選択の中で既に Take を採用済みの Shot の数。 */
  readonly alreadySelectedCount: number
  /** 選択の中でロック済み（生成できない）の数。 */
  readonly lockedCount: number
  /** 選択の中で説明も最初のフレームも無い（作品と関係ない映像になりやすい）数。判定は domain の `lacksStoryboard`。 */
  readonly unguidedCount: number
  readonly modelOptions: readonly BulkModelOption[]
  readonly cameraSizeOptions: readonly BulkSelectOption[]
  readonly locationOptions: readonly BulkSelectOption[]
  /**
   * 合計の見積（USD）。**省略できない。**
   *
   * 以前は省略可能で既定 `null` だったため、唯一の呼び出し元（`shot-list-panel`）が
   * 渡しておらず、「合計の見積」は一度も描画されなかった。利用者は
   * 「27 件の Shot に 3 本ずつ生成を依頼します。投入した生成は取り消せません（費用が
   * 発生します）」という確認を、**金額が伏せられたまま**押していた。
   * 省略できる形に戻すと同じ事故が再発するので、型で渡し忘れを止める。
   *
   * **`null` は「事前に見積もれない」。** 黙って空欄にせず、その旨を画面に出す。
   * `0` は「見積もった結果 0」。混ぜると、課金の有無を取り違える。
   */
  readonly estimatedTotalUsd: number | null
  readonly busy: boolean
  /** 投入した生成の進み具合。走っている間だけ非 null。 */
  readonly progress: BulkProgress | null
  readonly outcome: BulkOutcome | null
  readonly onGenerate: (input: BulkGenerateInput) => void
  readonly onSelectTakes: (rule: BulkTakeRule) => void
  readonly onUpdate: (patch: BulkUpdatePatch) => void
  readonly onClearSelection: () => void
  /** 確認のダイアログを開く。**ここでは消さない**（取り消しが無いため、確認は開いた先が取る）。 */
  readonly onDelete: () => void
  /** 結合の確認を開く（ADR-0024）。まとめられない組み合わせなら、開いた先が理由を言う。 */
  readonly onMerge: () => void
  /** 書き出しの画面を開く。チェックした Shot だけを書き出せる（制作者 2026-10-02）。 */
  readonly onRender: () => void
  /** 絵コンテの画像をまとめて作る（ADR-0029）。既定は絵の無い Shot だけ。 */
  readonly onDrawStartFrames: (input: { readonly onlyMissing: boolean }) => void
}

export const BulkActionBar = ({
  selectedCount,
  alreadySelectedCount,
  lockedCount,
  unguidedCount,
  modelOptions,
  cameraSizeOptions,
  locationOptions,
  estimatedTotalUsd,
  busy,
  progress,
  outcome,
  onGenerate,
  onSelectTakes,
  onUpdate,
  onClearSelection,
  onDelete,
  onMerge,
  onRender,
  onDrawStartFrames,
}: BulkActionBarProps) => {
  const idPrefix = useId()
  const [open, setOpen] = useState<PanelKey | null>(null)

  const toggleId = (key: PanelKey): string => `${idPrefix}-${key}-toggle`
  const panelId = (key: PanelKey): string => `${idPrefix}-${key}-panel`

  /**
   * 閉じたら開いたボタンへ焦点を戻す。**戻さないと現在地を失う。**
   * `ref` ではなく id で引くのは、`ui/button` が ref を受けないため
   * （`timeline-inline-form.tsx` と同じやり方）。
   */
  const close = (key: PanelKey): void => {
    setOpen(null)
    document.getElementById(toggleId(key))?.focus()
  }

  const toggle = (key: PanelKey): void => {
    if (open === key) close(key)
    else setOpen(key)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    // どの打鍵も外へ流さない。一覧には選択・再生の割り当てがある（lessons L-018）。
    event.stopPropagation()
    if (event.key !== 'Escape' || open === null) return
    event.preventDefault()
    close(open)
  }

  // 選択が 0 件のときは操作のバーを出さない（空のバーが画面を占め続けない）。
  // ただ、チェックしないと一括の操作があることすら見えず、Take をどこで作るか迷った（制作者 2026-09-30）。1 行だけ言う。
  if (selectedCount <= 0) {
    return (
      <p className="border-b border-line px-2 py-1 text-xs text-muted">
        チェックを付けると、まとめて Take を作れます（まとめて変更・絵コンテの画像・結合・削除も）。
      </p>
    )
  }

  const generatableCount = Math.max(0, selectedCount - lockedCount)

  return (
    <section
      aria-label="一括操作"
      onKeyDown={handleKeyDown}
      // 一覧の上に置く（UI-WORKBENCH-2 §7）。320px で崩れないよう、件数の行とボタンの行に分ける。
      className="sticky top-0 z-30 border-b border-line-strong bg-surface p-2 shadow-md"
    >
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold text-text">{selectedCount} 件を選択中</p>
        <div className="ml-auto flex gap-1">
          <Button size="sm" tone="secondary" disabled={busy} onClick={onClearSelection}>
            選択を{WORDING.unlink}
          </Button>
          <Button size="sm" tone="secondary" disabled={busy || selectedCount < 2} onClick={onMerge}>
            結合…
          </Button>
          <Button size="sm" tone="secondary" disabled={busy} onClick={onRender}>
            書き出す…
          </Button>
          <Button size="sm" tone="danger" disabled={busy} onClick={onDelete}>
            削除…
          </Button>
        </div>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-1">
        {PANEL_ORDER.map((key) => (
          <Button
            key={key}
            id={toggleId(key)}
            size="sm"
            tone="secondary"
            disabled={busy}
            aria-expanded={open === key}
            aria-controls={open === key ? panelId(key) : undefined}
            onClick={() => {
              toggle(key)
            }}
          >
            {PANEL_LABELS[key]}
          </Button>
        ))}
      </div>

      {open !== null && (
        <div
          id={panelId(open)}
          role="group"
          aria-label={PANEL_LABELS[open]}
          className="mt-3 rounded-md border border-line bg-surface-2 p-3"
        >
          {open === 'generate' && (
            <BulkGenerateForm
              idPrefix={`${idPrefix}-generate`}
              targetCount={generatableCount}
              lockedCount={lockedCount}
              unguidedCount={unguidedCount}
              modelOptions={modelOptions}
              estimatedTotalUsd={estimatedTotalUsd}
              busy={busy}
              onGenerate={(input) => {
                // **依頼したら閉じる。** 開いたままだと同じ件数に二重に依頼できてしまう
                // （実 Provider では二重に課金される）。進み具合は進捗ダイアログが出す。
                close('generate')
                onGenerate(input)
              }}
            />
          )}
          {open === 'selectTakes' && (
            <BulkSelectTakesForm
              idPrefix={`${idPrefix}-select-takes`}
              targetCount={selectedCount}
              alreadySelectedCount={alreadySelectedCount}
              busy={busy}
              onSelectTakes={(rule) => {
                close('selectTakes')
                onSelectTakes(rule)
              }}
            />
          )}
          {open === 'update' && (
            <BulkUpdateForm
              idPrefix={`${idPrefix}-update`}
              targetCount={selectedCount}
              cameraSizeOptions={cameraSizeOptions}
              locationOptions={locationOptions}
              busy={busy}
              onUpdate={onUpdate}
            />
          )}
          {open === 'draw' && (
            <BulkDrawForm
              idPrefix={`${idPrefix}-draw`}
              targetCount={selectedCount}
              busy={busy}
              onDraw={(input) => {
                // 頼んだら閉じる。開いたままだと同じ件数に二重に頼める。
                close('draw')
                onDrawStartFrames(input)
              }}
            />
          )}
        </div>
      )}

      {/**
        * 投入してから終わるまで手を止める。
        *
        * 以前は往復が終わった時点で手が空き、そのあとは一覧の状態が少しずつ
        * 変わるだけだった。**押したのに何も起きていないように見え**、実際に
        * 「反応していない」と読み違えた。数えて見せる。
        */}
      <ProgressDialog
        open={busy || progress !== null}
        title={`${WORDING.start}しています`}
        message={
          progress === null
            ? '依頼を送っています。'
            : `${String(progress.done)} / ${String(progress.total)} 件 終わりました`
        }
        value={progress === null || progress.total === 0 ? null : progress.done / progress.total}
      />

      {/**
        * 進捗はダイアログが出す。同じことをバーにも書くと読み上げが二重になる。
        * **走っている間は前回の結果を出さない。** 出すと「終わった」と読み違える。
        */}
      {!busy && progress === null && <BulkOutcomeView outcome={outcome} />}
    </section>
  )
}

/**
 * 結果。**失敗が 1 件でもあれば `alert`。**
 * 成功件数だけを出して失敗を静かに落とすと、やったつもりの件が残る。
 */
const BulkOutcomeView = ({ outcome }: { readonly outcome: BulkOutcome | null }) => {
  if (outcome === null) return null

  if (outcome.failures.length === 0) {
    return (
      <p role="status" className="mt-3 text-sm text-ok">
        {outcome.summary}
      </p>
    )
  }

  return (
    <div
      role="alert"
      className="mt-3 rounded-md border border-warn/40 bg-warn/10 p-3 text-sm text-warn"
    >
      <p>{outcome.summary}</p>
      <ul className="mt-1 list-disc pl-5">
        {outcome.failures.map((failure, index) => (
          <li key={`${String(index)}-${failure}`}>{failure}</li>
        ))}
      </ul>
    </div>
  )
}
