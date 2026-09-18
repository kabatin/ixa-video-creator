'use client'

import type { Shot } from '@ixa/domain'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { describeError } from '@/lib/api-error'
import { formatSpan } from '@/lib/format-time'

export type StoryboardInspectorProps = {
  readonly shot: Shot | null
  readonly isFirst: boolean
  readonly onSave: (
    shot: Shot,
    patch: Pick<Shot, 'description' | 'continuityMode'>,
  ) => Promise<void>
}

export const StoryboardInspector = ({ shot, isFirst, onSave }: StoryboardInspectorProps) => {
  const [description, setDescription] = useState('')
  const [continuityMode, setContinuityMode] = useState<Shot['continuityMode']>('independent')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    setDescription(shot?.description ?? '')
    setContinuityMode(shot?.continuityMode ?? 'independent')
    setMessage(null)
  }, [shot])

  if (shot === null) {
    return <p className="p-4 text-sm text-muted">ポスターを選ぶと Shot の設定が出ます。</p>
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    setMessage(null)
    try {
      await onSave(shot, { description, continuityMode })
      setMessage('保存しました。')
    } catch (error) {
      setMessage(`保存できませんでした: ${describeError(error)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full overflow-auto bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-text">{shot.code}</h2>
        <span className="text-xs tabular-nums text-muted">
          {formatSpan(shot.startSec, shot.durationSec)}
        </span>
      </div>

      <label className="mt-4 block text-sm font-medium text-text" htmlFor="storyboard-description">
        画の説明
      </label>
      <textarea
        id="storyboard-description"
        value={description}
        disabled={saving}
        onChange={(event) => {
          setDescription(event.target.value)
        }}
        rows={7}
        className="mt-1 w-full rounded-md border border-line-strong bg-bg px-3 py-2 text-sm text-text"
      />

      <label className="mt-4 block text-sm font-medium text-text" htmlFor="storyboard-continuity">
        前の Shot との接続
      </label>
      <select
        id="storyboard-continuity"
        value={isFirst ? 'independent' : continuityMode}
        disabled={saving || isFirst}
        onChange={(event) => {
          setContinuityMode(
            event.target.value === 'previous_shot' ? 'previous_shot' : 'independent',
          )
        }}
        className="mt-1 w-full rounded-md border border-line-strong bg-bg px-3 py-2 text-sm text-text"
      >
        <option value="independent">独立したカット</option>
        {!isFirst && <option value="previous_shot">前の Shot から画を繋ぐ</option>}
      </select>
      <p className="mt-2 text-xs text-muted">
        {isFirst
          ? '先頭の Shot には前のカットがないため接続できません。'
          : continuityMode === 'previous_shot'
            ? '前の採用 Take の最終フレームを開始画像にします。境界で約1フレーム止まって見える場合があります。'
            : '前のカットの絵を生成入力に使いません。'}
      </p>

      <div className="mt-5 flex items-center gap-3">
        <Button
          tone="primary"
          disabled={saving}
          onClick={() => {
            void save()
          }}
        >
          {saving ? '保存中…' : 'Shot を保存'}
        </Button>
        {message !== null && (
          <p role="status" className="text-sm text-muted">
            {message}
          </p>
        )}
      </div>
    </div>
  )
}
