'use client'

import {
  LookImageRole,
  type CharacterLookId,
  type CharacterLookImage,
  type CharacterLookImageId,
  type MediaAssetId,
  type WorkspaceId,
} from '@ixa/domain'
import { useCallback, useEffect, useState } from 'react'
import { ErrorPanel } from '@/components/error-panel'
import { ImageUploader } from '@/components/image-uploader'
import { LookImageGrid } from '@/components/look-image-grid'
import { SelectField } from '@/components/form/select-field'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { DEFAULT_LOOK_ROLE, LOOK_ROLE_OPTIONS } from '@/lib/look-images'

export type LookImagePanelProps = {
  readonly lookId: CharacterLookId
  readonly workspaceId: WorkspaceId
  readonly canonicalFrameAssetId: MediaAssetId | null
  readonly onPromote: (mediaAssetId: MediaAssetId) => void
}

/** 選択中の Look に紐づく画像の一覧と登録。 */
export const LookImagePanel = ({
  lookId,
  workspaceId,
  canonicalFrameAssetId,
  onPromote,
}: LookImagePanelProps) => {
  const [images, setImages] = useState<readonly CharacterLookImage[]>([])
  const [role, setRole] = useState<LookImageRole>(DEFAULT_LOOK_ROLE)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    setImages(await createApiClient().listLookImages(lookId))
  }, [lookId])

  useEffect(() => {
    let cancelled = false
    void createApiClient()
      .listLookImages(lookId)
      .then((loaded) => {
        if (!cancelled) setImages(loaded)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(`Look 画像を読み込めませんでした: ${describeError(cause)}`)
      })
    return () => {
      cancelled = true
    }
  }, [lookId])

  const attach = async (mediaAssetId: MediaAssetId): Promise<void> => {
    const created = await createApiClient().addLookImage(lookId, {
      mediaAssetId,
      role,
      isPrimary: images.length === 0,
      order: images.length,
    })
    setImages((current) => [...current, created])
  }

  const remove = (id: CharacterLookImageId): void => {
    setBusy(true)
    setError(null)
    void createApiClient()
      .removeLookImage(id)
      .then(reload)
      .catch((cause: unknown) => {
        setError(`Look 画像の削除に失敗しました: ${describeError(cause)}`)
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold text-text">Look 画像</h3>

      <div className="grid gap-4 rounded-lg border border-line bg-surface p-4 shadow-sm sm:grid-cols-2">
        <SelectField
          id="look-image-role"
          label="種類"
          value={role}
          options={LOOK_ROLE_OPTIONS}
          disabled={busy}
          onChange={(next) => {
            const parsed = LookImageRole.safeParse(next)
            if (parsed.success) setRole(parsed.data)
          }}
        />
        <ImageUploader
          id="look-image-file"
          workspaceId={workspaceId}
          submitLabel="Look 画像として登録"
          disabled={busy}
          onUploaded={attach}
        />
      </div>

      {error !== null && <ErrorPanel title="操作に失敗しました" message={error} />}

      <LookImageGrid
        images={images}
        canonicalFrameAssetId={canonicalFrameAssetId}
        busy={busy}
        onPromote={onPromote}
        onRemove={remove}
      />
    </section>
  )
}
