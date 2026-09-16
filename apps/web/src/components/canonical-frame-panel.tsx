'use client'

import { MediaAssetId, type CharacterLook } from '@ixa/domain'
import { useState } from 'react'
import { MediaImage } from '@/components/media-image'
import { TextField } from '@/components/form/text-field'
import { CANONICAL_FRAME_ABSENT_HINT, CANONICAL_FRAME_NOTICE } from '@/lib/look-images'

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
        present ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'
      }`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-semibold text-slate-900">canonical frame</h3>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            present ? 'bg-emerald-600 text-white' : 'bg-amber-200 text-amber-900'
          }`}
        >
          {present ? '設定済み' : '未設定'}
        </span>
      </div>

      <p className="mt-2 text-sm text-slate-700">{CANONICAL_FRAME_NOTICE}</p>
      {!present && (
        <p className="mt-2 text-sm font-medium text-amber-900">{CANONICAL_FRAME_ABSENT_HINT}</p>
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
        <button
          type="button"
          disabled={busy || draft.trim() === ''}
          onClick={submit}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          昇格させる
        </button>
      </div>
    </section>
  )
}
