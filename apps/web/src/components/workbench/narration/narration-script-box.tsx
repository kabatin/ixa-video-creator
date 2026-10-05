'use client'

import { VoiceProfileId, type ProjectId } from '@ixa/domain'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { ApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import type { WireNarrationOverview, WireVoice } from '@/lib/narration-api'

const UNDECIDED = ''

/**
 * 原稿を貼り付ける（ADR-0038）。1 行 = 1 フレーズに分けて、前からある行の後ろに足す。
 * 話す声は全部の行に付ける（あとで行ごとに替えられる）。
 */
export const NarrationScriptBox = ({
  projectId,
  voices,
  api,
  apply,
}: {
  readonly projectId: ProjectId
  readonly voices: readonly WireVoice[]
  readonly api: ApiClient
  readonly apply: (overview: WireNarrationOverview) => void
}) => {
  const [text, setText] = useState('')
  const [voiceId, setVoiceId] = useState<string>(voices[0]?.id ?? UNDECIDED)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = (): void => {
    setBusy(true)
    setError(null)
    api
      .pasteScript(projectId, text, voiceId === UNDECIDED ? null : VoiceProfileId.parse(voiceId))
      .then((overview) => {
        apply(overview)
        setText('')
      })
      .catch((cause: unknown) => {
        setError(describeForPerson(cause))
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <div className="space-y-2">
      <textarea
        aria-label="原稿"
        value={text}
        rows={5}
        placeholder={'勝負の時が来た。\n進め、戦子ちゃん！'}
        onChange={(event) => {
          setText(event.target.value)
        }}
        className="w-full rounded border border-line-strong bg-bg px-2 py-1 text-sm text-text"
      />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1">
          <span className="text-muted">話す声</span>
          <select
            aria-label="原稿の話す声"
            value={voiceId}
            onChange={(event) => {
              setVoiceId(event.target.value)
            }}
            className="h-6 rounded border border-line-strong bg-bg px-1 text-xs text-text"
          >
            <option value={UNDECIDED}>未定</option>
            {voices.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.name}
              </option>
            ))}
          </select>
        </label>
        <Button size="sm" tone="primary" disabled={busy || text.trim() === ''} onClick={submit}>
          行に分けて足す
        </Button>
        {voices.length === 0 && <span className="text-muted">声は素材ツリーの「声」で作ります。</span>}
      </div>
      {error !== null && (
        <p role="alert" className="text-xs text-danger">
          原稿を足せませんでした: {error}
        </p>
      )}
    </div>
  )
}
