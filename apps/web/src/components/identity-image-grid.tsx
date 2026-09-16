'use client'

import type { CharacterIdentityImage, CharacterIdentityImageId } from '@ixa/domain'
import { MediaImage } from '@/components/media-image'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { identityRoleHint, identityRoleLabel, primaryImageOfRole } from '@/lib/identity-images'
import { WORDING, deleteConfirmMessage } from '@/lib/wording'

export type IdentityImageGridProps = {
  readonly images: readonly CharacterIdentityImage[]
  readonly busy: boolean
  readonly onSetPrimary: (id: CharacterIdentityImageId) => void
  readonly onRemove: (id: CharacterIdentityImageId) => void
}

/**
 * 識別画像の一覧。
 * 主画像は「同じ role で 1 枚だけ」なので、どの role の主画像なのかまで出す。
 *
 * 削除は**取り消せない**。主画像を消すと、その role の参照が無くなる。
 * 確認文には role と主画像かどうかを必ず入れる。
 */
export const IdentityImageGrid = ({
  images,
  busy,
  onSetPrimary,
  onRemove,
}: IdentityImageGridProps) => {
  if (images.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600">
        識別画像がありません。まず四面図を登録してください。
      </p>
    )
  }

  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {images.map((image) => {
        const primaryOfRole = primaryImageOfRole(images, image.role)
        const supersedes = primaryOfRole !== undefined && primaryOfRole.id !== image.id
        const roleLabel = identityRoleLabel(image.role)
        const target = image.isPrimary ? `${roleLabel} の主画像` : `${roleLabel} の画像`

        return (
          <li
            key={image.id}
            className={`flex flex-col items-start gap-2 rounded-lg border bg-white p-3 shadow-sm ${
              image.isPrimary ? 'border-emerald-500 ring-1 ring-emerald-500' : 'border-slate-200'
            }`}
          >
            <MediaImage mediaAssetId={image.mediaAssetId} alt={roleLabel} />

            <div className="flex flex-wrap items-center gap-2">
              <span
                title={identityRoleHint(image.role)}
                className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700"
              >
                {roleLabel}
              </span>
              {image.isPrimary && (
                <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white">
                  この role の主画像
                </span>
              )}
            </div>

            <Button
              size="sm"
              disabled={busy || image.isPrimary}
              onClick={() => {
                onSetPrimary(image.id)
              }}
            >
              {image.isPrimary
                ? '主画像です'
                : supersedes
                  ? `主画像にする（現在の主画像は${WORDING.unlink}）`
                  : '主画像にする'}
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
