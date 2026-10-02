'use client'

import type { MediaAssetId, Shot, WorkspaceId } from '@ixa/domain'
import { useEffect, useMemo, useState } from 'react'
import { ImageUploader } from '@/components/image-uploader'
import { MediaImage } from '@/components/media-image'
import { Button } from '@/components/ui/button'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import type { ShotStartFrameApi, WireStartFrameState } from '@/lib/shot-start-frame-api'

/**
 * Shot の最初のフレーム（ADR-0025）。
 *
 * 画像を 1 枚付けると、生成のモデル「画像から動画（ローカル・無料）」で Take にできる。
 * 他のツールで作った絵や撮った写真を、そのまま Take・採用・レビューの流れに載せる口。
 * **「まだ読めていない」と「付いていない」を混ぜない**（L-015）。
 *
 * 絵コンテの画像を AI で作ることもできる（ADR-0029）。作るのは worker で 1 枚 1 分ほど。
 * できたら出来事が届いて `version` が変わり、読み直して差し替わる。作っている間と失敗は直近のジョブで言う。
 */

type Job = WireStartFrameState['job']

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly mediaAssetId: MediaAssetId | null; readonly job: Job }
  | { readonly kind: 'error'; readonly message: string }

const isDrawing = (job: Job): boolean => job?.status === 'queued' || job?.status === 'running'

export type StartFrameFieldProps = {
  readonly shot: Shot
  readonly workspaceId: WorkspaceId
  readonly disabled?: boolean
  /** 付いているかが変わったら知らせる（生成欄が押せるかの判定に使う）。 */
  readonly onChange?: (hasStartFrame: boolean) => void
  /** 変わったら読み直す（ドロップで付けたとき・絵ができたときに追いつく）。 */
  readonly version?: number
  /**
   * 付けた・外したあと（読み込んだだけでは呼ばない）。サムネとプレビューを読み直させる
   * （Take が無い Shot はプレビューに絵コンテの画像を映す。制作者 2026-10-02）。
   */
  readonly onSaved?: () => void
  readonly api?: ShotStartFrameApi
}

export const StartFrameField = ({
  shot,
  workspaceId,
  disabled = false,
  onChange,
  version = 0,
  onSaved,
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
        if (alive) setState({ kind: 'ready', mediaAssetId: current.mediaAssetId, job: current.job })
      })
      .catch((cause: unknown) => {
        if (alive) setState({ kind: 'error', message: describeForPerson(cause) })
      })
    return () => {
      alive = false
    }
  }, [client, shot.id, version])

  const current = state.kind === 'ready' ? state.mediaAssetId : null
  const job = state.kind === 'ready' ? state.job : null
  const drawing = isDrawing(job)
  useEffect(() => {
    if (state.kind === 'ready') onChange?.(state.mediaAssetId !== null)
  }, [state, onChange])

  const attach = async (mediaAssetId: MediaAssetId): Promise<void> => {
    setError(null)
    const saved = await client.setStartFrame(shot.id, mediaAssetId)
    setState({ kind: 'ready', mediaAssetId: saved.mediaAssetId, job })
    onSaved?.()
  }

  const detach = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await client.clearStartFrame(shot.id)
      setState({ kind: 'ready', mediaAssetId: null, job })
      onSaved?.()
    } catch (cause) {
      setError(`外せませんでした: ${describeForPerson(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  /** AI で作る。頼めたら「作っています」にし、できあがりは出来事で読み直す。 */
  const draw = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const { jobId } = await client.generateStartFrame(shot.id)
      setState((previous) =>
        previous.kind === 'ready' ? { ...previous, job: { id: jobId, status: 'queued', error: null } } : previous,
      )
    } catch (cause) {
      setError(`頼めませんでした: ${describeForPerson(cause)}`)
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
        <Button size="sm" disabled={disabled || busy || drawing} onClick={() => void draw()}>
          {current === null ? 'AI で絵を作る' : 'AI で作り直す'}
        </Button>
      )}
      {drawing && (
        <p role="status" className="text-xs text-muted">
          絵コンテの画像を作っています（1 枚 1 分ほど）。できたら、ここに出ます。
        </p>
      )}
      {job?.status === 'failed' && (
        <p role="alert" className="text-xs text-danger">
          {`絵を作れませんでした: ${job.error ?? '理由が届きませんでした。'}`}
        </p>
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
