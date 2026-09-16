'use client'

import type { CharacterLookImage, CharacterLookImageId, MediaAssetId } from '@ixa/domain'
import { MediaImage } from '@/components/media-image'
import { lookRoleLabel } from '@/lib/look-images'

export type LookImageGridProps = {
  readonly images: readonly CharacterLookImage[]
  readonly canonicalFrameAssetId: MediaAssetId | null
  readonly busy: boolean
  readonly onPromote: (mediaAssetId: MediaAssetId) => void
  readonly onRemove: (id: CharacterLookImageId) => void
}

/** Look 画像の一覧。canonical frame へ昇格させる導線もここに置く。 */
export const LookImageGrid = ({
  images,
  canonicalFrameAssetId,
  busy,
  onPromote,
  onRemove,
}: LookImageGridProps) => {
  if (images.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600">
        この Look の画像がありません。衣装の参照を登録してください。
      </p>
    )
  }

  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {images.map((image) => {
        const isCanonical = canonicalFrameAssetId === image.mediaAssetId

        return (
          <li
            key={image.id}
            className={`flex flex-col gap-2 rounded-lg border bg-white p-3 shadow-sm ${
              isCanonical ? 'border-emerald-500 ring-1 ring-emerald-500' : 'border-slate-200'
            }`}
          >
            <MediaImage mediaAssetId={image.mediaAssetId} alt={lookRoleLabel(image.role)} />

            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                {lookRoleLabel(image.role)}
              </span>
              {isCanonical && (
                <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white">
                  canonical frame
                </span>
              )}
            </div>

            <button
              type="button"
              disabled={busy || isCanonical}
              onClick={() => {
                onPromote(image.mediaAssetId)
              }}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
            >
              {isCanonical ? 'canonical frame です' : 'canonical frame にする'}
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => {
                onRemove(image.id)
              }}
              className="text-xs text-red-700 underline hover:text-red-900 disabled:cursor-not-allowed disabled:text-slate-400"
            >
              削除
            </button>
          </li>
        )
      })}
    </ul>
  )
}
