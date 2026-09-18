'use client'

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { FIELD_CONTROL_CLASS, FIELD_HINT_CLASS } from '@/components/form/field-styles'

/**
 * 表のセルの中でそのまま直せる欄（P58-3）。
 *
 * **一覧から出さないための部品。** 27 個の Shot を直すのに「詳細へ入る → 直す →
 * 保存 → 戻る」を 27 回繰り返した、という制作者の報告が出発点になっている。
 * 説明（複数行）と mood（1 行）の両方に使うため、種別は `multiline` で切り替える。
 *
 * **幅を自分で決めない。** 置かれるのは表のセルなので、親の幅に従う。
 * `w-*` を足さないこと。
 *
 * **打鍵を外へ漏らさない。** 一覧には選択などの割り当てが乗る（lessons L-018）。
 * 欄の中の打鍵はすべてここで止め、外の割り当てが誤って動かないようにする。
 */

// --- 打鍵の割り当て ---

export type InlineTextKeyEvent = {
  readonly key: string
  readonly metaKey: boolean
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
}

export type InlineTextKeyAction =
  /** 保存して読む姿へ戻る。 */
  | 'save'
  /** 元の値に戻して閉じる。 */
  | 'cancel'
  /** 欄の中で処理させる（改行・文字入力）。ただし外へは漏らさない。 */
  | 'contain'

/**
 * 割り当ての正はこの関数 1 つ。**画面に出す説明もここから作る**（lessons L-018）。
 * 手で書いた説明は、割り当てが変わっても静かに古いまま残る。
 */
export const resolveInlineTextKey = (
  event: InlineTextKeyEvent,
  multiline: boolean,
): InlineTextKeyAction => {
  if (event.key === 'Escape') return 'cancel'
  if (event.key !== 'Enter') return 'contain'
  // Shift+Enter は必ず改行。複数行でも 1 行でも、保存の意味に使わない。
  if (event.shiftKey) return 'contain'
  if (event.metaKey || event.ctrlKey) return 'save'
  // 複数行のときの素の Enter は改行。文章の途中で勝手に閉じない。
  return multiline ? 'contain' : 'save'
}

type KeyProbe = {
  readonly keys: string
  readonly event: InlineTextKeyEvent
}

const KEY_PROBES: readonly KeyProbe[] = Object.freeze([
  { keys: 'Enter', event: { key: 'Enter', metaKey: false, ctrlKey: false, shiftKey: false } },
  { keys: '⌘/Ctrl + Enter', event: { key: 'Enter', metaKey: true, ctrlKey: false, shiftKey: false } },
  { keys: 'Escape', event: { key: 'Escape', metaKey: false, ctrlKey: false, shiftKey: false } },
])

const ACTION_LABELS: Readonly<Record<'save' | 'cancel', string>> = Object.freeze({
  save: '保存',
  cancel: '取り消し',
})

export type InlineTextKeyHelp = {
  readonly keys: string
  readonly action: string
}

/**
 * 画面に出す打鍵の一覧。**実際の判定を通して作る。**
 * 同じ働きの打鍵が複数あるときは、最初に見つかったものだけを出す。
 */
export const describeInlineTextKeys = (multiline: boolean): readonly InlineTextKeyHelp[] => {
  const seen = new Set<string>()
  return KEY_PROBES.reduce<readonly InlineTextKeyHelp[]>((help, probe) => {
    const action = resolveInlineTextKey(probe.event, multiline)
    if (action === 'contain' || seen.has(action)) return help
    seen.add(action)
    return [...help, { keys: probe.keys, action: ACTION_LABELS[action] }]
  }, [])
}

// --- 失敗の理由 ---

/** 理由が読み取れないときも「保存できなかった」ことだけは必ず出す。黙って閉じない。 */
const failureMessage = (reason: unknown): string => {
  if (reason instanceof Error && reason.message.trim() !== '') return reason.message
  return '保存できませんでした。'
}

// --- 部品 ---

export type InlineTextCellProps = {
  readonly value: string
  /** 説明のような文章は true（textarea）。mood のような 1 行は false（input）。 */
  readonly multiline?: boolean
  /** 空のときに出す、押せると分かる文（例: 「説明を追加」）。`—` は使わない。 */
  readonly placeholder: string
  /** 読み上げ用の名前（例: 「CUT-01 の説明」）。 */
  readonly label: string
  readonly maxLength?: number
  readonly disabled?: boolean
  /** 失敗は reject で伝えること。握り潰すと画面上は保存できたように見える。 */
  readonly onSave: (next: string) => Promise<void>
}

export const InlineTextCell = ({
  value,
  multiline = false,
  placeholder,
  label,
  maxLength,
  disabled = false,
  onSave,
}: InlineTextCellProps) => {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const controlRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  /** 保存の実行中。ここが true の間に来た blur は保存に使わない。 */
  const pendingRef = useRef(false)
  /**
   * この編集はもう決着している（保存済み・取り消し済み・変更なしで閉じた）。
   * **これが二重発火の止め金。** Enter で閉じた直後に飛んでくる blur を弾く。
   */
  const settledRef = useRef(false)
  /** 読む姿へ戻ったときに焦点を戻すかどうか。 */
  const restoreFocusRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // 開いたら焦点を移し、元の値を全選択する。打ち始めれば置き換わり、
  // 直したいだけなら矢印で解ける。
  useLayoutEffect(() => {
    if (!editing) return
    const control = controlRef.current
    if (!control) return
    control.focus()
    control.select()
  }, [editing])

  // 閉じたら読む姿のボタンへ戻す。**戻す必要があるときだけ**呼ぶ
  // （焦点をいつ奪ったかは最終状態から確かめられない。lessons L-022）。
  useLayoutEffect(() => {
    if (editing || !restoreFocusRef.current) return
    restoreFocusRef.current = false
    buttonRef.current?.focus()
  }, [editing])

  const open = (): void => {
    if (disabled) return
    pendingRef.current = false
    settledRef.current = false
    setDraft(value)
    setError(null)
    setEditing(true)
  }

  const close = (): void => {
    settledRef.current = true
    restoreFocusRef.current = true
    setSaving(false)
    setError(null)
    setEditing(false)
  }

  const cancel = (): void => {
    if (pendingRef.current) return
    close()
  }

  const commit = (): void => {
    if (settledRef.current || pendingRef.current) return
    // 変わっていないなら送らない。無駄な PATCH を出さない。
    if (draft === value) {
      close()
      return
    }
    pendingRef.current = true
    setSaving(true)
    setError(null)
    void onSave(draft).then(
      () => {
        pendingRef.current = false
        if (!mountedRef.current) return
        close()
      },
      (reason: unknown) => {
        pendingRef.current = false
        if (!mountedRef.current) return
        // **直す姿のまま残す。** 打った内容を捨てない。
        setSaving(false)
        setError(failureMessage(reason))
      },
    )
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    const action = resolveInlineTextKey(
      {
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
      },
      multiline,
    )
    // どの打鍵も外へ流さない。外には一覧の割り当てがある（lessons L-018）。
    event.stopPropagation()
    if (action === 'contain') return
    event.preventDefault()
    if (action === 'cancel') cancel()
    else commit()
  }

  if (!editing) {
    const empty = value.trim() === ''
    return (
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-label={`${label}: ${empty ? placeholder : value}`}
        onClick={open}
        onKeyDown={(event) => {
          // Enter / Space は開くだけ。外の割り当てへは流さない。
          event.stopPropagation()
        }}
        className={
          'w-full rounded-md px-2 py-1 text-left text-sm ' +
          'hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 ' +
          'focus-visible:outline-offset-2 focus-visible:outline-slate-900 ' +
          'disabled:cursor-not-allowed disabled:text-slate-500 disabled:hover:bg-transparent ' +
          (empty ? 'text-slate-600 underline decoration-dotted' : 'whitespace-pre-wrap text-slate-900')
        }
      >
        {empty ? placeholder : value}
      </button>
    )
  }

  const controlProps = {
    value: draft,
    maxLength,
    disabled: saving,
    'aria-label': label,
    'aria-invalid': error !== null,
    onKeyDown: handleKeyDown,
    onBlur: commit,
    onChange: (event: { readonly target: { readonly value: string } }) => {
      setDraft(event.target.value)
    },
    className: FIELD_CONTROL_CLASS,
  }

  return (
    <div>
      {multiline ? (
        <textarea
          {...controlProps}
          ref={(node) => {
            controlRef.current = node
          }}
          rows={3}
        />
      ) : (
        <input
          {...controlProps}
          type="text"
          ref={(node) => {
            controlRef.current = node
          }}
        />
      )}
      <p className={`mt-1 ${FIELD_HINT_CLASS}`}>
        {describeInlineTextKeys(multiline)
          .map((help) => `${help.keys} で${help.action}`)
          .join(' / ')}
      </p>
      {saving ? (
        <p role="status" className={`mt-1 ${FIELD_HINT_CLASS}`}>
          保存中
        </p>
      ) : null}
      {error === null ? null : (
        <p role="alert" className="mt-1 text-xs text-rose-700">
          {error}
        </p>
      )}
    </div>
  )
}
