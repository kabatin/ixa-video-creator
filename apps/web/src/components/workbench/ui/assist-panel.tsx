'use client'

import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { INPUT_CLASS } from '@/components/workbench/ui/section'
import { describeForPerson } from '@/lib/api-error'

/** AI に案を出してもらう口。いまの文と注文（任意）を渡し、欄に入れる文を 1 つ受け取る。 */
export type AssistRequest = (current: string, instruction: string | null) => Promise<string>

type State =
  | { readonly kind: 'closed' }
  | { readonly kind: 'open' }
  | { readonly kind: 'asking' }
  | { readonly kind: 'proposed'; readonly text: string }
  | { readonly kind: 'error'; readonly message: string }

/**
 * 欄の「✦ AI」（ADR-0032 の 3 段目）。注文（任意）を添えて案を出し、**「使う」を押すまで欄は変わらない。**
 * 空の欄なら材料から考え、書いてあれば意図を残して整える（決め方はサーバのプロンプト）。
 */
export const AssistPanel = ({
  label,
  current,
  request,
  onUse,
}: {
  readonly label: string
  readonly current: string
  readonly request: AssistRequest
  /** 「使う」。欄に入れて保存する（いつもの ↺ で戻せる）。 */
  readonly onUse: (text: string) => void
}) => {
  const id = useId()
  const [state, setState] = useState<State>({ kind: 'closed' })
  const [instruction, setInstruction] = useState('')

  const ask = async (): Promise<void> => {
    setState({ kind: 'asking' })
    try {
      const text = await request(current, instruction.trim() === '' ? null : instruction.trim())
      setState({ kind: 'proposed', text })
    } catch (cause) {
      setState({ kind: 'error', message: `案を出せませんでした: ${describeForPerson(cause)}` })
    }
  }

  if (state.kind === 'closed') {
    return (
      <button
        type="button"
        aria-label={`${label} の案を AI に出してもらう`}
        title={current.trim() === '' ? '作品の材料から案を出します' : '意図を残して整えた案を出します'}
        onClick={() => {
          setState({ kind: 'open' })
        }}
        className="mt-0.5 rounded px-1 text-xs text-accent hover:bg-surface-2"
      >
        ✦ AI
      </button>
    )
  }

  return (
    <div className="mt-1 space-y-1.5 rounded border border-line bg-surface-2 p-2 text-xs">
      <div className="flex items-center gap-1.5">
        <label htmlFor={`${id}-instruction`} className="sr-only">
          AI への注文（任意）
        </label>
        <input
          id={`${id}-instruction`}
          value={instruction}
          placeholder="注文（任意）例: もっと静かに"
          onChange={(event) => {
            setInstruction(event.target.value)
          }}
          className={`${INPUT_CLASS} flex-1`}
        />
        <Button size="sm" disabled={state.kind === 'asking'} onClick={() => void ask()}>
          {state.kind === 'asking' ? '考えています…' : '案を出す'}
        </Button>
        <button
          type="button"
          aria-label="閉じる"
          onClick={() => {
            setState({ kind: 'closed' })
          }}
          className="h-6 rounded px-1 text-muted hover:text-text"
        >
          ×
        </button>
      </div>
      {state.kind === 'error' && (
        <p role="alert" className="text-danger">
          {state.message}
        </p>
      )}
      {state.kind === 'proposed' && (
        <div className="space-y-1.5">
          <p className="whitespace-pre-wrap rounded bg-surface p-2 text-sm text-text">{state.text}</p>
          <div className="flex justify-end gap-1.5">
            <Button
              size="sm"
              onClick={() => {
                setState({ kind: 'open' })
              }}
            >
              やめる
            </Button>
            <Button
              size="sm"
              tone="primary"
              onClick={() => {
                onUse(state.text)
                setState({ kind: 'closed' })
              }}
            >
              使う
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
