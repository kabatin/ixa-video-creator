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
 * `bg-slate-300` に白文字はコントラスト比 1.48 で読めなかった。
 */
const TONES: Readonly<Record<ButtonTone, string>> = Object.freeze({
  primary:
    'bg-slate-900 text-white hover:bg-slate-700 focus-visible:outline-slate-900 ' +
    'disabled:bg-slate-200 disabled:text-slate-500',
  secondary:
    'border border-slate-300 text-slate-700 hover:bg-slate-50 focus-visible:outline-slate-500 ' +
    'disabled:border-slate-200 disabled:text-slate-400',
  danger:
    'bg-rose-700 text-white hover:bg-rose-800 focus-visible:outline-rose-700 ' +
    'disabled:bg-rose-200 disabled:text-rose-700',
})

export type ButtonProps = {
  readonly tone?: ButtonTone
  readonly size?: ButtonSize
  readonly children: ReactNode
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>

export const Button = ({ tone = 'secondary', size = 'md', children, ...rest }: ButtonProps) => (
  <button {...rest} type={rest.type ?? 'button'} className={`${BASE} ${SIZES[size]} ${TONES[tone]}`}>
    {children}
  </button>
)
