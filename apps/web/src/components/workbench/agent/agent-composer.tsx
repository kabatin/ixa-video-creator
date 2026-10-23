'use client'

import { useState } from 'react'
import { AGENT_MESSAGE_TEXT_MAX } from '@ixa/domain'
import { Button } from '@/components/ui/button'
import { AGENT_MODEL_CHOICES } from '@/lib/agent-api'

/**
 * 入力欄・送信・止める・モデルの選択（ADR-0058）。⌘Enter（Ctrl+Enter）で送る。Enter は改行。
 * 作業中は送れない（止めてから話し直す）。
 */
export const AgentComposer = ({
  busy,
  model,
  onModelChange,
  onSend,
  onStop,
}: {
  readonly busy: boolean
  readonly model: string
  readonly onModelChange: (model: string) => void
  /** 送れたら true（入力欄を空にする）。 */
  readonly onSend: (text: string) => Promise<boolean>
  readonly onStop: () => void
}) => {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const canSend = !busy && !sending && text.trim() !== ''
  const send = async (): Promise<void> => {
    if (!canSend) return
    setSending(true)
    try {
      if (await onSend(text.trim())) setText('')
    } finally {
      setSending(false)
    }
  }
  return (
    <div className="shrink-0 space-y-1 border-t border-line bg-surface p-2">
      <textarea
        aria-label="AI エージェントへの依頼"
        className="block h-16 w-full resize-y rounded border border-line bg-bg px-2 py-1 text-sm text-text"
        placeholder={busy ? '作業中です。止めてから話し直せます' : '例: この Shot の効果音を派手に（⌘Enter で送る）'}
        maxLength={AGENT_MESSAGE_TEXT_MAX}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
            event.preventDefault()
            void send()
          }
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-muted">
          モデル
          <select
            className="rounded border border-line bg-bg px-1 py-0.5 text-xs text-text"
            value={model}
            disabled={busy}
            onChange={(event) => onModelChange(event.target.value)}
          >
            {AGENT_MODEL_CHOICES.map((choice) => (
              <option key={choice.id} value={choice.id}>{choice.label}</option>
            ))}
          </select>
        </label>
        <span className="ml-auto flex gap-2">
          {busy && (
            <Button size="sm" onClick={onStop}>
              止める
            </Button>
          )}
          <Button tone="primary" size="sm" disabled={!canSend} onClick={() => void send()}>
            送信
          </Button>
        </span>
      </div>
    </div>
  )
}
