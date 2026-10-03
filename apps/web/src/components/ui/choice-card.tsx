import type { ReactNode } from 'react'

/**
 * カードの形の選択（中身は本物のラジオボタン。キーボードと読み上げはそのまま使える）。
 * 書き出し・新規作成・プロジェクト設定で共有する（制作者 2026-10-03「UI/UX が雑な印象」「サイズ図を選ぶ形がよさそう」）。
 * 選んだカードは枠と地の色で示す。
 */

const CARD =
  'flex cursor-pointer gap-3 rounded-md border border-line bg-surface px-3 py-2 ' +
  'hover:bg-surface-2 has-[:checked]:border-accent has-[:checked]:bg-accent-soft/15 ' +
  'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus ' +
  'has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60'

export const ChoiceCard = ({
  name,
  checked,
  disabled = false,
  onSelect,
  figure,
  stacked = false,
  children,
}: {
  readonly name: string
  readonly checked: boolean
  readonly disabled?: boolean
  readonly onSelect: () => void
  /** 左に置く図（形・大きさ）。無ければラジオの丸だけ。 */
  readonly figure?: ReactNode
  /** 図を上、言葉を下に積む（狭い列に 5 つ並べるとき）。 */
  readonly stacked?: boolean
  readonly children: ReactNode
}) => (
  <label className={`${CARD} ${stacked ? 'flex-col items-center text-center' : 'items-start'}`}>
    <input
      type="radio"
      name={name}
      checked={checked}
      disabled={disabled}
      onChange={onSelect}
      className={figure === undefined ? 'mt-1 accent-[rgb(var(--accent))]' : 'sr-only'}
    />
    {figure}
    <span className={`flex min-w-0 flex-col gap-0.5 ${stacked ? 'items-center' : ''}`}>{children}</span>
  </label>
)

/** カードの組。見出しは小さく、カードは詰めて並べる（`columns` 列）。 */
export const ChoiceGroup = ({
  legend,
  columns = 1,
  disabled = false,
  children,
}: {
  readonly legend: string
  readonly columns?: 1 | 2 | 3 | 5
  readonly disabled?: boolean
  readonly children: ReactNode
}) => (
  <fieldset disabled={disabled}>
    <legend className="mb-2 text-xs font-semibold text-muted">{legend}</legend>
    <div className={`grid gap-2 ${GRID[columns]}`}>{children}</div>
  </fieldset>
)

const GRID: Readonly<Record<1 | 2 | 3 | 5, string>> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-2 sm:grid-cols-3',
  5: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5',
}
