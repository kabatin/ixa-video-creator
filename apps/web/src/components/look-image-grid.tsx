'use client'

import type { CharacterLookImage, CharacterLookImageId, MediaAssetId } from '@ixa/domain'
import { MediaImage } from '@/components/media-image'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { lookRoleLabel } from '@/lib/look-images'
import { WORDING, deleteConfirmMessage } from '@/lib/wording'

export type LookImageGridProps = {
  readonly images: readonly CharacterLookImage[]
  readonly canonicalFrameAssetId: MediaAssetId | null
  readonly busy: boolean
  readonly onPromote: (mediaAssetId: MediaAssetId) => void
  readonly onRemove: (id: CharacterLookImageId) => void
}

/**
 * Look 画像の一覧。canonical frame へ昇格させる導線もここに置く。
 *
 * 削除は**取り消せない**。どの role の画像が消えるかを確認文に必ず入れる。
 * 画像は縮小表示なので、押す前にどれを指しているか言葉でも分かる必要がある。
 */
export const LookImageGrid = ({
  images,
  canonicalFrameAssetId,
  busy,
  onPromote,
  onRemove,
}: LookImageGridProps) => {
  if (images.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line-strong bg-surface p-6 text-center text-sm text-muted">
        この Look の画像がありません。衣装の参照を登録してください。
      </p>
    )
  }

  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {images.map((image) => {
        const isCanonical = canonicalFrameAssetId === image.mediaAssetId
        const roleLabel = lookRoleLabel(image.role)
        // canonical frame は生成の基準になる。消える対象としてそこまで書く。
        const target = isCanonical
          ? `canonical frame の画像（${roleLabel}）`
          : `${roleLabel} の画像`

        return (
          <li
            key={image.id}
            className={`flex flex-col items-start gap-2 rounded-lg border bg-surface p-3 shadow-sm ${
              isCanonical ? 'border-ok/40 ring-1 ring-ok/40' : 'border-line'
            }`}
          >
            <MediaImage mediaAssetId={image.mediaAssetId} alt={roleLabel} />

            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-surface-2 px-2 py-0.5 text-xs font-medium text-text">
                {roleLabel}
              </span>
              {isCanonical && (
                <span className="rounded-full bg-ok px-2 py-0.5 text-xs font-semibold text-bg">
                  canonical frame
                </span>
              )}
            </div>

            <Button
              size="sm"
              disabled={busy || isCanonical}
              onClick={() => {
                onPromote(image.mediaAssetId)
              }}
            >
              {isCanonical ? 'canonical frame です' : 'canonical frame にする'}
            </Button>

            <ConfirmButton
              size="sm"
              label={`${WORDING.delete}（${roleLabel}）`}
              message={deleteConfirmMessage(target)}
              disabled={busy}
              onConfirm={() => {
                onRemove(image.id)
              }}
            />
          </li>
        )
      })}
    </ul>
  )
}
