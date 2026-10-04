import type { BulkProgress } from '@/components/workbench/use-bulk-actions'

/**
 * 一括操作のバーの部品（`bulk-action-bar.tsx` から分けた）: 進み具合・「その他」のメニュー・結果。
 */

/** 一括の結果。**1 件ずつの失敗を畳まない**（lessons L-015）。要約は呼び出し側が作る。 */
export type BulkOutcome = {
  readonly summary: string
  readonly failures: readonly string[]
}

/**
 * 進み具合。**画面を止めない**（制作者 2026-10-03「動画生成中、長時間ダイアログ表示で動けなくなるのはなんとかしたい」）。
 * 以前は閉じられない全画面のダイアログで、27 本なら 1 時間半ほど何もできなかった。生成は worker が続けるので、
 * バーの中で数えて見せ、ほかの作業をしてよいと言う。選択を外しても出し続ける。
 */
export const BulkProgressStrip = ({
  busy,
  progress,
}: {
  readonly busy: boolean
  readonly progress: BulkProgress | null
}) => {
  if (!busy && progress === null) return null
  const percent = progress === null || progress.total === 0 ? null : Math.round((progress.done / progress.total) * 100)
  return (
    <div role="status" className="mb-2 space-y-1 text-xs text-text">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-semibold">
          {progress === null ? '依頼を送っています。' : `${String(progress.done)} / ${String(progress.total)} 件 終わりました`}
        </span>
        {progress !== null && <span className="text-muted">ほかの作業をしていて構いません（終わると知らせます）。</span>}
      </p>
      <div
        role="progressbar"
        aria-label="一括操作の進み具合"
        aria-valuemin={0}
        aria-valuemax={100}
        {...(percent === null ? {} : { 'aria-valuenow': percent })}
        className="h-1.5 w-full overflow-hidden rounded-full bg-line"
      >
        <div
          className={`h-full rounded-full bg-info ${percent === null ? 'w-1/3 animate-pulse' : ''}`}
          style={percent === null ? undefined : { width: `${String(percent)}%` }}
        />
      </div>
    </div>
  )
}

export type MoreItem = {
  readonly label: string
  readonly danger?: boolean
  readonly disabled?: boolean
  readonly run: () => void
}

/** 「その他」の中身（あまり使わない操作）。バーの上に重ねて出す。 */
export const MoreMenu = ({ id, items }: { readonly id: string; readonly items: readonly MoreItem[] }) => (
  <div id={id} role="menu" aria-label="その他" className="mb-2 flex flex-col rounded-md border border-line bg-surface-2 py-1">
    {items.map((item) => (
      <button
        key={item.label}
        type="button"
        role="menuitem"
        disabled={item.disabled === true}
        onClick={item.run}
        className={`h-7 px-3 text-left text-xs hover:bg-surface disabled:cursor-not-allowed disabled:text-muted ${
          item.danger === true ? 'text-danger' : 'text-text'
        }`}
      >
        {item.label}
      </button>
    ))}
  </div>
)

/**
 * 結果。**失敗が 1 件でもあれば `alert`。**
 * 成功件数だけを出して失敗を静かに落とすと、やったつもりの件が残る。
 */
export const BulkOutcomeView = ({ outcome }: { readonly outcome: BulkOutcome | null }) => {
  if (outcome === null) return null

  if (outcome.failures.length === 0) {
    return (
      <p role="status" className="mb-2 text-sm text-ok">
        {outcome.summary}
      </p>
    )
  }

  return (
    <div role="alert" className="mb-2 rounded-md border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
      <p>{outcome.summary}</p>
      <ul className="mt-1 list-disc pl-5">
        {outcome.failures.map((failure, index) => (
          <li key={`${String(index)}-${failure}`}>{failure}</li>
        ))}
      </ul>
    </div>
  )
}
