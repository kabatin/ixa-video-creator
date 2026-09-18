import Link from 'next/link'
import type { ReactNode } from 'react'

/** 行き止まりから抜ける経路。**「一覧へ戻る」のように、行った先で何ができるか分かる言葉にする。** */
export type ErrorPanelAction = {
  readonly href: string
  readonly label: string
}

export type ErrorPanelProps = {
  readonly title: string
  readonly message: string
  readonly hint?: string
  /**
   * 次に行ける場所。省略できる（既存の呼び出しはそのまま動く）。
   * **行き止まりを作らないために、可能なら必ず 1 つは渡すこと。**
   */
  readonly actions?: readonly ErrorPanelAction[]
  /** リンクでは表せない操作（再試行ボタンなど）。 */
  readonly children?: ReactNode
}

/**
 * 異常を白画面にせず、原因と次の行動が分かる形で表示する。
 *
 * **ここは「存在しない」「読めなかった」専用。** 中身が 0 件なだけのときは
 * `EmptyState` を使う。混ぜると、利用者は異常を正常だと思う。
 */
export const ErrorPanel = ({ title, message, hint, actions, children }: ErrorPanelProps) => (
  <div role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-6">
    <h2 className="text-base font-semibold text-danger">{title}</h2>
    <p className="mt-2 whitespace-pre-wrap break-words text-sm text-danger">{message}</p>
    {hint !== undefined && <p className="mt-3 text-sm text-danger">{hint}</p>}
    {actions !== undefined && actions.length > 0 && (
      <ul className="mt-4 flex flex-wrap items-center gap-4">
        {actions.map((action) => (
          <li key={action.href}>
            <Link href={action.href} className="text-sm text-danger underline hover:opacity-80">
              {action.label}
            </Link>
          </li>
        ))}
      </ul>
    )}
    {children !== undefined && (
      <div className="mt-4 flex flex-wrap items-center gap-3">{children}</div>
    )}
  </div>
)
