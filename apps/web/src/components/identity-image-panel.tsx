'use client'

import {
  IdentityImageRole,
  type CharacterId,
  type CharacterIdentityImage,
  type CharacterIdentityImageId,
  type MediaAssetId,
  type WorkspaceId,
} from '@ixa/domain'
import { useState } from 'react'
import { ErrorPanel } from '@/components/error-panel'
import { FourViewNotice } from '@/components/four-view-notice'
import { IdentityImageGrid } from '@/components/identity-image-grid'
import { ImageUploader } from '@/components/image-uploader'
import { SelectField } from '@/components/form/select-field'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import {
  DEFAULT_IDENTITY_ROLE,
  hasFourView,
  identityRoleHint,
  IDENTITY_ROLE_OPTIONS,
  primaryImageOfRole,
} from '@/lib/identity-images'

export type IdentityImagePanelProps = {
  readonly characterId: CharacterId
  readonly workspaceId: WorkspaceId
  readonly initialImages: readonly CharacterIdentityImage[]
}

/** 識別画像の登録・主画像の切り替え・削除。 */
export const IdentityImagePanel = ({
  characterId,
  workspaceId,
  initialImages,
}: IdentityImagePanelProps) => {
  const [images, setImages] = useState<readonly CharacterIdentityImage[]>(initialImages)
  const [role, setRole] = useState<IdentityImageRole>(DEFAULT_IDENTITY_ROLE)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = async (): Promise<void> => {
    setImages(await createApiClient().listIdentityImages(characterId))
  }

  const run = (label: string, task: () => Promise<void>): void => {
    setBusy(true)
    setError(null)
    void task()
      .catch((cause: unknown) => {
        setError(`${label}に失敗しました: ${describeError(cause)}`)
      })
      .finally(() => {
        setBusy(false)
      })
  }

  const attach = async (mediaAssetId: MediaAssetId): Promise<void> => {
    // その role に主画像がまだ無ければ、登録した 1 枚目を主画像にする。
    const isPrimary = primaryImageOfRole(images, role) === undefined
    const created = await createApiClient().addIdentityImage(characterId, {
      mediaAssetId,
      role,
      isPrimary,
      order: images.length,
    })
    setImages((current) => [...current, created])
  }

  const setPrimary = (id: CharacterIdentityImageId): void => {
    run('主画像の切り替え', async () => {
      await createApiClient().setPrimaryIdentityImage(id)
      // 同じ role の他の画像も解除されるため、一覧ごと引き直す。
      await reload()
    })
  }

  const remove = (id: CharacterIdentityImageId): void => {
    run('識別画像の削除', async () => {
      await createApiClient().removeIdentityImage(id)
      await reload()
    })
  }

  return (
    <section className="space-y-4">
      <h2 className="text-base font-semibold text-text">識別画像</h2>

      <FourViewNotice present={hasFourView(images)} />

      <div className="grid gap-4 rounded-lg border border-line bg-surface p-4 shadow-sm sm:grid-cols-2">
        <div>
          <SelectField
            id="identity-image-role"
            label="種類"
            value={role}
            options={IDENTITY_ROLE_OPTIONS}
            disabled={busy}
            onChange={(next) => {
              const parsed = IdentityImageRole.safeParse(next)
              if (parsed.success) setRole(parsed.data)
            }}
          />
          <p className="mt-1 text-xs text-muted">{identityRoleHint(role)}</p>
        </div>

        <ImageUploader
          id="identity-image-file"
          workspaceId={workspaceId}
          submitLabel="識別画像として登録"
          disabled={busy}
          onUploaded={attach}
        />
      </div>

      {error !== null && <ErrorPanel title="操作に失敗しました" message={error} />}

      <IdentityImageGrid
        images={images}
        busy={busy}
        onSetPrimary={setPrimary}
        onRemove={remove}
      />
    </section>
  )
}
