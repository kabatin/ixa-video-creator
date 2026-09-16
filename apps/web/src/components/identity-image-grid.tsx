'use client'

import type { CharacterIdentityImage, CharacterIdentityImageId } from '@ixa/domain'
import { MediaImage } from '@/components/media-image'
import { identityRoleHint, identityRoleLabel, primaryImageOfRole } from '@/lib/identity-images'

export type IdentityImageGridProps = {
  readonly images: readonly CharacterIdentityImage[]
  readonly busy: boolean
  readonly onSetPrimary: (id: CharacterIdentityImageId) => void
  readonly onRemove: (id: CharacterIdentityImageId) => void
}

/**
 * 識別画像の一覧。
 * 主画像は「同じ role で 1 枚だけ」なので、どの role の主画像なのかまで出す。
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

        return (
          <li
            key={image.id}
            className={`flex flex-col gap-2 rounded-lg border bg-white p-3 shadow-sm ${
              image.isPrimary ? 'border-emerald-500 ring-1 ring-emerald-500' : 'border-slate-200'
            }`}
          >
            <MediaImage mediaAssetId={image.mediaAssetId} alt={identityRoleLabel(image.role)} />

            <div className="flex flex-wrap items-center gap-2">
              <span
                title={identityRoleHint(image.role)}
                className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700"
              >
                {identityRoleLabel(image.role)}
              </span>
              {image.isPrimary && (
                <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white">
                  この role の主画像
                </span>
              )}
            </div>

            <button
              type="button"
              disabled={busy || image.isPrimary}
              onClick={() => {
                onSetPrimary(image.id)
              }}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
            >
              {image.isPrimary
                ? '主画像です'
                : supersedes
                  ? '主画像にする（現在の主画像は解除）'
                  : '主画像にする'}
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
