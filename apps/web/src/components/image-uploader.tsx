'use client'

import { MediaKind, type MediaAssetId, type WorkspaceId } from '@ixa/domain'
import { useState } from 'react'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { uploadStageLabel, UploadError } from '@/lib/upload-error'

export type ImageUploaderProps = {
  readonly id: string
  readonly workspaceId: WorkspaceId
  readonly submitLabel: string
  readonly disabled?: boolean
  /** アップロードで得た MediaAsset を紐づける処理。失敗は呼び出し側が表示する。 */
  readonly onUploaded: (mediaAssetId: MediaAssetId) => Promise<void>
}

/**
 * 署名 → PUT → 完了通知をまとめて実行する（docs/ARCHITECTURE.md §7）。
 * 進捗は扱わないが、失敗はどの段階で落ちたかが必ず分かるようにする。
 */
export const ImageUploader = ({
  id,
  workspaceId,
  submitLabel,
  disabled = false,
  onUploaded,
}: ImageUploaderProps) => {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 入力欄を初期化するために付け替える key。DOM を直接いじらずに選択状態を捨てる。
  const [inputGeneration, setInputGeneration] = useState(0)

  const upload = async (target: File): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const asset = await createApiClient().uploadMedia(target, {
        workspaceId,
        kind: MediaKind.enum.image,
      })
      await onUploaded(asset.id)
      setFile(null)
      setInputGeneration((generation) => generation + 1)
    } catch (cause) {
      const stage = cause instanceof UploadError ? `（${uploadStageLabel(cause.stage)}）` : ''
      setError(`アップロードに失敗しました${stage}: ${describeError(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium text-text">
        画像ファイル
      </label>
      <input
        key={inputGeneration}
        id={id}
        name={id}
        type="file"
        accept="image/*"
        disabled={disabled || busy}
        onChange={(event) => {
          setError(null)
          setFile(event.target.files?.[0] ?? null)
        }}
        className="block w-full text-sm text-text file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-text"
      />

      <button
        type="button"
        disabled={disabled || busy || file === null}
        onClick={() => {
          if (file === null) return
          void upload(file)
        }}
        className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg hover:bg-accent/90 disabled:cursor-not-allowed disabled:bg-line-strong"
      >
        {busy ? 'アップロード中…' : submitLabel}
      </button>

      {error !== null && (
        <p role="alert" className="whitespace-pre-wrap break-words text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
