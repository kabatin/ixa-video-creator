import Link from 'next/link'
import { LinkButton } from '@/components/ui/button'

/**
 * 「無い」「空」「読めなかった」「読み込み中」の 4 つを混ぜないための語彙。
 *
 * この 4 つは**別々の事実**で、利用者に求める次の行動も違う。
 *
 * | 状態 | 意味 | 次にすること |
 * |---|---|---|
 * | `missing` | 対象そのものが存在しない | 一覧から辿り直す |
 * | `empty` | 対象はあるが中身が 0 件 | 最初の 1 件を作る |
 * | `unreadable` | 読めなかった（あるかどうか不明） | 再読み込みする |
 * | `loading` | 取得中 | 待つ |
 *
 * 以前、Shot 一覧は `missing` を `empty` に畳んでいた。存在しない Project を開くと
 * 「Shot がありません / 最初の Shot を作成」と出て、利用者は「Project はあるが
 * Shot が無い」と読み違えた。**畳んだ先が「正常」に見えると、人はそれを信じる**
 * （lessons L-015）。区別を 1 箇所に置いて、畳めないようにする。
 */
export type ViewStateKind = 'missing' | 'empty' | 'unreadable' | 'loading'

export type ViewState = {
  readonly kind: ViewStateKind
  readonly title: string
  readonly hint: string
  /** 異常は `alert`、それ以外は `status`。読み上げの割り込み方が変わる。 */
  readonly role: 'alert' | 'status'
}

/** 英数字で終わる語と和文の間には空白を入れる（「Shot を」）。 */
const joinSubject = (subject: string, tail: string): string =>
  /[A-Za-z0-9]$/.test(subject) ? `${subject} ${tail}` : `${subject}${tail}`

const TITLE: Readonly<Record<ViewStateKind, (subject: string) => string>> = Object.freeze({
  missing: (subject) => joinSubject(subject, 'が見つかりません'),
  empty: (subject) => joinSubject(subject, 'がありません'),
  unreadable: (subject) => joinSubject(subject, 'を読み込めませんでした'),
  loading: (subject) => joinSubject(subject, 'を読み込んでいます'),
})

const HINT: Readonly<Record<ViewStateKind, string>> = Object.freeze({
  missing: 'URL が古いか、すでに削除された可能性があります。一覧から辿り直してください。',
  empty: 'まだ 1 件もありません。',
  unreadable: '通信か API 側の問題です。少し待ってから再読み込みしてください。',
  loading: 'そのままお待ちください。',
})

const ROLE: Readonly<Record<ViewStateKind, 'alert' | 'status'>> = Object.freeze({
  missing: 'alert',
  empty: 'status',
  unreadable: 'alert',
  loading: 'status',
})

/** 状態の種類と対象から、見出し・補足・読み上げの区分を決める。 */
export const describeViewState = (kind: ViewStateKind, subject: string): ViewState =>
  Object.freeze({ kind, title: TITLE[kind](subject), hint: HINT[kind], role: ROLE[kind] })

export type EmptyStateProps = {
  readonly message: string
  readonly actionHref: string
  readonly actionLabel: string
  /**
   * 推奨の作り方が複数あるときの補足。**「無い」と混ざる言葉を書かないこと。**
   */
  readonly hint?: string
  /** 二番目の入口。推奨ではないがやりたい人向けの経路。 */
  readonly secondaryHref?: string
  readonly secondaryLabel?: string
}

/**
 * 中身が 0 件であることと、そこから何を作れるかを示す。
 *
 * **ここは「正常だが空」専用。** 対象が存在しない・読めなかったときに使わない。
 * それらは `ErrorPanel` が担当する。
 */
export const EmptyState = ({
  message,
  actionHref,
  actionLabel,
  hint,
  secondaryHref,
  secondaryLabel,
}: EmptyStateProps) => (
  <div
    role="status"
    className="rounded-lg border border-dashed border-line-strong bg-surface p-12 text-center"
  >
    <p className="text-sm text-muted">{message}</p>
    {hint !== undefined && <p className="mt-2 text-sm text-muted">{hint}</p>}
    <div className="mt-4">
      <LinkButton href={actionHref} tone="primary">
        {actionLabel}
      </LinkButton>
    </div>
    {secondaryHref !== undefined && secondaryLabel !== undefined && (
      <p className="mt-3 text-sm">
        <Link href={secondaryHref} className="text-muted underline hover:text-text">
          {secondaryLabel}
        </Link>
      </p>
    )}
  </div>
)
