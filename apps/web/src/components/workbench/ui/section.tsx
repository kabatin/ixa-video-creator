import type { ReactNode } from 'react'

/**
 * パネルの中の区切り（UI-WORKBENCH-2 §8）。**カードにしない。** 小見出しと罫線だけ。
 * 箱の中に箱を作ると、320px の右ペインの 3 割が余白になった。
 */
export const Section = ({
  title,
  action,
  children,
}: {
  readonly title: string
  /** 見出しの右に置く小さな操作（「＋ 追加」など）。 */
  readonly action?: ReactNode
  readonly children: ReactNode
}) => (
  <section className="border-t border-line py-2 first:border-t-0 first:pt-0">
    <div className="mb-1.5 flex items-center gap-2">
      <h3 className="text-xs font-semibold text-muted">{title}</h3>
      {action !== undefined && <div className="ml-auto flex items-center gap-1">{action}</div>}
    </div>
    <div className="space-y-1.5">{children}</div>
  </section>
)

/** 欄の並び。ラベルは左（狭ければ上）。 */
export const FieldRow = ({
  label,
  htmlFor,
  children,
}: {
  readonly label: string
  readonly htmlFor?: string
  readonly children: ReactNode
}) => (
  <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-x-2">
    <label htmlFor={htmlFor} className="pt-1 text-sm text-muted">
      {label}
    </label>
    <div className="min-w-0">{children}</div>
  </div>
)

/** 入力欄の見た目（高さ 1.75rem）。部品ごとに書き写さない。 */
export const INPUT_CLASS =
  'h-7 w-full rounded border border-line-strong bg-bg px-2 text-sm text-text ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus disabled:text-muted'

export const TEXTAREA_CLASS =
  'min-h-16 w-full rounded border border-line-strong bg-bg px-2 py-1 text-sm text-text ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus disabled:text-muted'
