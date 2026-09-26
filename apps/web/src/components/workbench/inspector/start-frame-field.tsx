'use client'

import type { MediaAssetId, Shot, WorkspaceId } from '@ixa/domain'
import { useEffect, useMemo, useState } from 'react'
import { ImageUploader } from '@/components/image-uploader'
import { MediaImage } from '@/components/media-image'
import { Button } from '@/components/ui/button'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import type { ShotStartFrameApi } from '@/lib/shot-start-frame-api'

/**
 * Shot の最初のフレーム（ADR-0025）。
 *
 * 画像を 1 枚付けると、生成のモデル「画像から動画（ローカル・無料）」で Take にできる。
 * 他のツールで作った絵や撮った写真を、そのまま Take・採用・レビューの流れに載せる口。
 * **「まだ読めていない」と「付いていない」を混ぜない**（L-015）。
 */

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly mediaAssetId: MediaAssetId | null }
  | { readonly kind: 'error'; readonly message: string }

export type StartFrameFieldProps = {
  readonly shot: Shot
  readonly workspaceId: WorkspaceId
  readonly disabled?: boolean
  /** 付いているかが変わったら知らせる（生成欄が押せるかの判定に使う）。 */
  readonly onChange?: (hasStartFrame: boolean) => void
  /** 変わったら読み直す（`workbench.serverEpoch`。ドロップで付けたときに追いつく）。 */
  readonly version?: number
  readonly api?: ShotStartFrameApi
}

export const StartFrameField = ({
  shot,
  workspaceId,
  disabled = false,
  onChange,
  version = 0,
  api,
}: StartFrameFieldProps) => {
  const client = useMemo<ShotStartFrameApi>(() => api ?? createApiClient(), [api])
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setState({ kind: 'loading' })
    client
      .getStartFrame(shot.id)
      .then((current) => {
        if (alive) setState({ kind: 'ready', mediaAssetId: current.mediaAssetId })
      })
      .catch((cause: unknown) => {
        if (alive) setState({ kind: 'error', message: describeForPerson(cause) })
      })
    return () => {
      alive = false
    }
  }, [client, shot.id, version])

  const current = state.kind === 'ready' ? state.mediaAssetId : null
  useEffect(() => {
    if (state.kind === 'ready') onChange?.(state.mediaAssetId !== null)
  }, [state, onChange])

  const attach = async (mediaAssetId: MediaAssetId): Promise<void> => {
    setError(null)
    const saved = await client.setStartFrame(shot.id, mediaAssetId)
    setState({ kind: 'ready', mediaAssetId: saved.mediaAssetId })
  }

  const detach = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await client.clearStartFrame(shot.id)
      setState({ kind: 'ready', mediaAssetId: null })
    } catch (cause) {
      setError(`外せませんでした: ${describeForPerson(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted">最初のフレーム</p>
      {state.kind === 'loading' && <p className="text-xs text-muted">読み込んでいます…</p>}
      {state.kind === 'error' && (
        <p role="alert" className="text-xs text-danger">
          {`最初のフレームを読めませんでした: ${state.message}`}
        </p>
      )}
      {state.kind === 'ready' && current === null && (
        <p className="text-xs text-muted">
          画像を付けると、生成のモデル「画像から動画（ローカル・無料）」でこの絵を動かした Take を作れます。
        </p>
      )}
      {current !== null && (
        <div className="space-y-1">
          <MediaImage
            mediaAssetId={current}
            alt="最初のフレーム"
            className="aspect-video w-full rounded object-cover ring-1 ring-line"
          />
          <Button size="sm" disabled={disabled || busy} onClick={() => void detach()}>
            外す
          </Button>
        </div>
      )}
      {state.kind === 'ready' && (
        <ImageUploader
          id={`start-frame-${shot.id}`}
          workspaceId={workspaceId}
          submitLabel={current === null ? '画像を付ける' : '画像を付け替える'}
          disabled={disabled || busy}
          onUploaded={attach}
        />
      )}
      {error !== null && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
