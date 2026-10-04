'use client'

import { MediaAssetId, type CharacterLook } from '@ixa/domain'
import { useState } from 'react'
import { MediaImage } from '@/components/media-image'
import { TextField } from '@/components/form/text-field'
import { CANONICAL_FRAME_ABSENT_HINT, CANONICAL_FRAME_NOTICE } from '@/lib/look-images'
import { Button } from '@/components/ui/button'

export type CanonicalFramePanelProps = {
  readonly look: CharacterLook
  readonly busy: boolean
  readonly onSet: (mediaAssetId: MediaAssetId) => void
}

const INVALID_ID = 'MediaAsset ID が ULID ではありません。'

/**
 * Look の canonical frame（docs/ARCHITECTURE.md §8）。
 * 承認済み Take のフレームを昇格させると、以降の Shot がそれを最優先で参照し
 * 外見のドリフトが止まる。未設定であることが分かるようにする。
 */
export const CanonicalFramePanel = ({ look, busy, onSet }: CanonicalFramePanelProps) => {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const present = look.canonicalFrameAssetId !== null

  const submit = (): void => {
    const parsed = MediaAssetId.safeParse(draft.trim())
    if (!parsed.success) {
      setError(INVALID_ID)
      return
    }
    setError(undefined)
    setDraft('')
    onSet(parsed.data)
  }

  return (
    <section
      className={`rounded-lg border p-4 ${
        present ? 'border-ok/40 bg-ok/10' : 'border-warn/40 bg-warn/10'
      }`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-semibold text-text">canonical frame</h3>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            present ? 'bg-ok text-bg' : 'bg-warn/25 text-warn'
          }`}
        >
          {present ? '設定済み' : '未設定'}
        </span>
      </div>

      <p className="mt-2 text-sm text-text">{CANONICAL_FRAME_NOTICE}</p>
      {!present && (
        <p className="mt-2 text-sm font-medium text-warn">{CANONICAL_FRAME_ABSENT_HINT}</p>
      )}

      {look.canonicalFrameAssetId !== null && (
        <div className="mt-3 w-40">
          <MediaImage
            mediaAssetId={look.canonicalFrameAssetId}
            alt={`${look.name} の canonical frame`}
          />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <TextField
            id={`canonical-frame-${look.id}`}
            label="承認 Take のフレーム（MediaAsset ID）"
            value={draft}
            placeholder="01ARZ3NDEKTSV4RRFFQ69G5FAV"
            disabled={busy}
            error={error}
            onChange={(next) => {
              setDraft(next)
            }}
          />
        </div>
        <Button tone="primary" disabled={busy || draft.trim() === ''} onClick={submit}>
          昇格させる
        </Button>
      </div>
    </section>
  )
}
