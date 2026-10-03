import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * ボタンの見た目を 1 箇所に集める。
 *
 * **直接 class を書かないこと。** 以前は 36 箇所すべてが直書きで、同じ意味の
 * 主ボタンが 5 種類の見た目に分かれていた（余白と無効時の色がばらついていた）。
 *
 * `tone` は**取り消せるかどうか**で選ぶ。見た目の好みで選ばない。
 * 以前は最も目立つ赤い塗りが「却下」（取り消せる）に付き、取り消せない削除が
 * 控えめな下線テキストになっていて、危険度の表現が逆転していた。
 */
export type ButtonTone =
  /** 主要な操作。画面に 1 つか 2 つまで。 */
  | 'primary'
  /** 補助的な操作。取り消せる。 */
  | 'secondary'
  /** **取り消せない操作。** 削除など、やり直しがきかないものだけに使う。 */
  | 'danger'

export type ButtonSize = 'md' | 'sm'

const BASE =
  'inline-flex items-center justify-center rounded-md font-medium transition-colors ' +
  // フォーカスが見えないと、キーボードだけの利用者が現在地を見失う。
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'disabled:cursor-not-allowed'

const SIZES: Readonly<Record<ButtonSize, string>> = Object.freeze({
  md: 'px-4 py-2 text-sm',
  sm: 'px-3 py-1.5 text-xs',
})

/**
 * 無効時の色は文字とのコントラストで選ぶ。
 * 以前の薄い灰（slate-300 相当）の地に白文字はコントラスト比 1.48 で読めなかった。
 * 役割の名前にしたいまも同じで、無効は `line` の上に `muted`（薄くしすぎない）。
 */
const TONES: Readonly<Record<ButtonTone, string>> = Object.freeze({
  primary:
    'bg-accent text-accent-fg hover:bg-accent/90 focus-visible:outline-focus ' +
    'disabled:bg-line disabled:text-muted',
  secondary:
    'border border-line-strong text-text hover:bg-surface-2 focus-visible:outline-focus ' +
    'disabled:border-line disabled:text-muted',
  danger:
    'bg-danger text-bg hover:bg-danger/90 focus-visible:outline-focus ' +
    'disabled:bg-line disabled:text-muted',
})

export type ButtonProps = {
  readonly tone?: ButtonTone
  readonly size?: ButtonSize
  /**
   * 文字を折り返さない。狭い列に並べると、日本語はどの字の間でも折れ、ボタンの中で 1 字ずつ縦に崩れた
   * （制作者 2026-10-03「Shot 一覧の選択メニューがすべて改行してしまっている」）。並べる側が幅を受け持つときに付ける。
   */
  readonly nowrap?: boolean
  readonly children: ReactNode
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>

export const Button = ({ tone = 'secondary', size = 'md', nowrap = false, children, ...rest }: ButtonProps) => (
  <button
    {...rest}
    type={rest.type ?? 'button'}
    className={`${BASE} ${SIZES[size]} ${TONES[tone]}${nowrap ? ' whitespace-nowrap' : ''}`}
  >
    {children}
  </button>
)
