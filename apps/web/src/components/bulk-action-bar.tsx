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
import { BulkOutcomeView, BulkProgressStrip, MoreMenu, type BulkOutcome } from '@/components/bulk-action-bar-parts'
import { Button } from '@/components/ui/button'
import { BulkDrawForm } from '@/components/bulk-draw-form'
import type { BulkProgress } from '@/components/workbench/use-bulk-actions'
import { WORDING } from '@/lib/wording'

/**
 * 選ぶと一覧の下端に貼り付く操作バー（P58-4）。
 *
 * 制作者は 27 件の Shot に対して生成の依頼を 27 回、採用を 27 回した。
 * 一覧で選んで、ここで 1 回で済ませる。
 *
 * **1 行にまとめ、一覧の下端に重ねる**（制作者 2026-10-03「選択した時に出るメニューが混みあっててすべて改行してしまってる」
 * 「✅ で選ぶとメニューが上部に出てくるが、リストの縦位置が下がってずれて地味に不便。最下部固定でリストに被る感じで」）。
 * よく使う 2 つ（絵を作る・Take を作る）だけを出し、残りは「その他」。開いた設定はバーの上に重ねて出す。
 *
 * **状態も API 呼び出しもここには無い。** 選択は一覧が持ち、送信は配線側が行う。
 * 入力の中身は `bulk-action-forms.tsx`。**同時に開くのは 1 つ。**
 */

export { buildBulkPatch, bulkPatchError, hasBulkPatch } from '@/components/bulk-action-forms'
export type {
  BulkGenerateInput,
  BulkModelOption,
  BulkSelectOption,
  BulkTakeRule,
  BulkUpdatePatch,
} from '@/components/bulk-action-forms'
export type { BulkOutcome } from '@/components/bulk-action-bar-parts'

type PanelKey = 'generate' | 'selectTakes' | 'update' | 'draw'

const PANEL_LABELS: Readonly<Record<PanelKey, string>> = {
  generate: 'Take を作る',
  selectTakes: '一括採用',
  update: '一括で変える',
  draw: '絵を作る',
}

/** バーに直接並べる 2 つ（作業の順: 絵 → Take）。残りは「その他」の中。 */
const MAIN_PANELS: readonly PanelKey[] = ['draw', 'generate']

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
  /** 絵コンテ（説明）が空の Shot が混じっているときの確認の文。無ければ null（`drawWithoutStoryboardWarning`）。 */
  readonly drawWarning: string | null
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
  drawWarning,
}: BulkActionBarProps) => {
  const idPrefix = useId()
  const [open, setOpen] = useState<PanelKey | 'more' | null>(null)
  /** 開いた設定を閉じたとき焦点を戻すボタン（「その他」から開いたものは「その他」へ）。 */
  const [opener, setOpener] = useState<string | null>(null)

  const toggleId = (key: PanelKey): string => `${idPrefix}-${key}-toggle`
  const moreId = `${idPrefix}-more-toggle`
  const panelId = (key: PanelKey | 'more'): string => `${idPrefix}-${key}-panel`

  /**
   * 閉じたら開いたボタンへ焦点を戻す。**戻さないと現在地を失う。**
   * `ref` ではなく id で引くのは、`ui/button` が ref を受けないため（`timeline-inline-form.tsx` と同じやり方）。
   */
  const close = (): void => {
    const back = open === 'more' ? moreId : opener
    setOpen(null)
    setOpener(null)
    if (back !== null) document.getElementById(back)?.focus()
  }

  const toggle = (key: PanelKey): void => {
    if (open === key) {
      close()
      return
    }
    setOpen(key)
    setOpener(toggleId(key))
  }

  /** 「その他」から設定を開く。閉じたら「その他」へ焦点を戻す。 */
  const openFromMore = (key: PanelKey): void => {
    setOpen(key)
    setOpener(moreId)
    // メニューが消えると焦点が行き場を失い、Escape がバーに届かなくなる。「その他」に置いておく。
    document.getElementById(moreId)?.focus()
  }

  /** 「その他」から確認の画面を開く操作（結合・書き出す・削除）。メニューは閉じる。 */
  const runFromMore = (run: () => void): void => {
    setOpen(null)
    setOpener(null)
    run()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    // どの打鍵も外へ流さない。一覧には選択・再生の割り当てがある（lessons L-018）。
    event.stopPropagation()
    if (event.key !== 'Escape' || open === null) return
    event.preventDefault()
    close()
  }

  // 選択が 0 件のときは操作のバーを出さない（空のバーが画面を占め続けない）。
  // ただ、チェックしないと一括の操作があることすら見えず、Take をどこで作るか迷った（制作者 2026-09-30）。1 行だけ言う。
  // 走っている一括の進み具合は、選択を外しても出し続ける。
  if (selectedCount <= 0) {
    return (
      <div className="sticky bottom-0 z-30 border-t border-line bg-surface px-2 py-1">
        <BulkProgressStrip busy={busy} progress={progress} />
        <p className="text-xs text-muted">
          チェックを付けると、まとめて絵や Take を作れます（まとめて変更・結合・書き出し・削除も）。
        </p>
      </div>
    )
  }

  const generatableCount = Math.max(0, selectedCount - lockedCount)

  return (
    <section
      aria-label="一括操作"
      onKeyDown={handleKeyDown}
      // 一覧の下端に貼り付けて重ねる（一覧を押し下げない）。開いた設定はこの上へ伸びる。
      className="sticky bottom-0 z-30 border-t border-line-strong bg-surface p-2 shadow-[0_-6px_16px_rgb(0_0_0/0.25)]"
    >
      {open !== null && open !== 'more' && (
        <div
          id={panelId(open)}
          role="group"
          aria-label={PANEL_LABELS[open]}
          className="relative mb-2 max-h-[50vh] overflow-auto rounded-md border border-line bg-surface-2 p-3"
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
                // （実 Provider では二重に課金される）。進み具合はバーが数えて出す。
                close()
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
                close()
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
              warning={drawWarning}
              onDraw={(input) => {
                // 頼んだら閉じる。開いたままだと同じ件数に二重に頼める。
                close()
                onDrawStartFrames(input)
              }}
            />
          )}
        </div>
      )}

      {open === 'more' && (
        <MoreMenu
          id={panelId('more')}
          items={[
            { label: `${PANEL_LABELS.selectTakes}…`, disabled: busy, run: () => { openFromMore('selectTakes') } },
            { label: `${PANEL_LABELS.update}…`, disabled: busy, run: () => { openFromMore('update') } },
            { label: '結合…', disabled: busy || selectedCount < 2, run: () => { runFromMore(onMerge) } },
            { label: '書き出す…', disabled: busy, run: () => { runFromMore(onRender) } },
            { label: '削除…', danger: true, disabled: busy, run: () => { runFromMore(onDelete) } },
          ]}
        />
      )}

      <BulkProgressStrip busy={busy} progress={progress} />
      {/* 走っている間は前回の結果を出さない。出すと「終わった」と読み違える。 */}
      {!busy && progress === null && <BulkOutcomeView outcome={outcome} />}

      <div className="flex items-center gap-1">
        <span className="whitespace-nowrap text-sm font-semibold text-text">{`${String(selectedCount)} 件`}</span>
        <button
          type="button"
          aria-label={`選択を${WORDING.unlink}`}
          title={`選択を${WORDING.unlink}`}
          disabled={busy}
          onClick={onClearSelection}
          className="h-6 w-6 whitespace-nowrap rounded text-muted hover:bg-surface-2 hover:text-text disabled:opacity-50"
        >
          ✕
        </button>
        <span className="ml-auto flex items-center gap-1">
          {MAIN_PANELS.map((key) => (
            <Button
              key={key}
              id={toggleId(key)}
              size="sm"
              tone={key === 'generate' ? 'primary' : 'secondary'}
              nowrap
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
          <Button
            id={moreId}
            size="sm"
            nowrap
            aria-haspopup="menu"
            aria-expanded={open === 'more'}
            onClick={() => {
              if (open === 'more') close()
              else setOpen('more')
            }}
          >
            その他
          </Button>
        </span>
      </div>
    </section>
  )
}
