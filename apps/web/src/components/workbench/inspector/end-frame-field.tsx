'use client'

import type { MediaAssetId, Shot, ShotId, WorkspaceId } from '@ixa/domain'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ImageUploader } from '@/components/image-uploader'
import { MediaImage } from '@/components/media-image'
import { Button } from '@/components/ui/button'
import { INPUT_CLASS } from '@/components/workbench/ui/section'
import { InfoTip, SubPart } from '@/components/workbench/ui/collapsible-section'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import type { ShotEndFrameApi } from '@/lib/shot-end-frame-api'
import type { ShotStartFrameApi } from '@/lib/shot-start-frame-api'

/**
 * Shot の終わりの画像。付けた画像が、作る動画の最後のコマになる（例: 最後の Shot を最初の Shot の絵で終えてループにする）。
 *
 * 付けるとサーバが「Take を尺に合わせる」に替えるので、付けたら `onSaved` で Shot を読み直させる（時間の合わせ方の欄が追いつく）。
 * 取り消し（⌘Z）のあとは `version` が進んで読み直す。最初のフレームの欄と同じ。
 * **「まだ読めていない」と「付いていない」を混ぜない**（L-015）。AI で作る口は無い。
 */

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly mediaAssetId: MediaAssetId | null }
  | { readonly kind: 'error'; readonly message: string }

/** 最初のフレームが付いている、ほかの Shot。 */
export type EndFrameCandidate = { readonly id: ShotId; readonly code: string }

type EndFrameClient = ShotEndFrameApi & Pick<ShotStartFrameApi, 'getStartFrame'>

export const END_FRAME_NOTE = '最後のコマがこの画像になるよう、Take を尺に合わせて再生します'

export type EndFrameFieldProps = {
  readonly shot: Shot
  readonly workspaceId: WorkspaceId
  /** 最初のフレームが付いているほかの Shot。選ぶとその絵を終わりの画像にする。 */
  readonly candidates: readonly EndFrameCandidate[]
  readonly disabled?: boolean
  /** 変わったら読み直す（取り消しで戻ったときに追いつく）。 */
  readonly version?: number
  /** 付けた・外したあと（読み込んだだけでは呼ばない）。Shot を読み直させる。 */
  readonly onSaved?: () => void
  readonly api?: EndFrameClient
}

export const EndFrameField = ({
  shot,
  workspaceId,
  candidates,
  disabled = false,
  version = 0,
  onSaved,
  api,
}: EndFrameFieldProps) => {
  const client = useMemo<EndFrameClient>(() => api ?? createApiClient(), [api])
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadedShotId = useRef<ShotId | null>(null)
  const pickerId = useId()

  useEffect(() => {
    let alive = true
    // 「読み込んでいます」にするのは別の Shot に移ったときだけ。同じ Shot の読み直しは今の絵を出したまま差し替える。
    if (loadedShotId.current !== shot.id) setState({ kind: 'loading' })
    loadedShotId.current = shot.id
    client
      .getEndFrame(shot.id)
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

  const attach = async (mediaAssetId: MediaAssetId): Promise<void> => {
    setError(null)
    const saved = await client.setEndFrame(shot.id, mediaAssetId)
    setState({ kind: 'ready', mediaAssetId: saved.mediaAssetId })
    onSaved?.()
  }

  /** 走らせている間は押せなくし、失敗は欄の下に出す。 */
  const run = (failure: string, work: () => Promise<void>): void => {
    setBusy(true)
    setError(null)
    void work()
      .catch((cause: unknown) => setError(`${failure}: ${describeForPerson(cause)}`))
      .finally(() => setBusy(false))
  }

  const takeStartFrameOf = (otherId: ShotId): void => {
    const code = candidates.find((candidate) => candidate.id === otherId)?.code ?? 'その Shot'
    run('付けられませんでした', async () => {
      const frame = await client.getStartFrame(otherId)
      if (frame.mediaAssetId === null) {
        setError(`${code} の最初のフレームが見つかりませんでした。`)
        return
      }
      await attach(frame.mediaAssetId)
    })
  }

  const detach = (): void => {
    run('外せませんでした', async () => {
      await client.clearEndFrame(shot.id)
      setState({ kind: 'ready', mediaAssetId: null })
      onSaved?.()
    })
  }

  // 普段使わないので、まとまりごと畳んでおく（2026-10-26）。付いていれば題に添える（開かなくても分かる）。
  return (
    <SubPart title={current === null ? '終わりの画像' : '終わりの画像（あり）'}>
      <div className="flex items-center gap-1">
        <p className="text-xs font-semibold text-muted">終わりの画像</p>
        <InfoTip label="終わりの画像">{END_FRAME_NOTE}</InfoTip>
      </div>
      {state.kind === 'loading' && <p className="text-xs text-muted">読み込んでいます…</p>}
      {state.kind === 'error' && (
        <p role="alert" className="text-xs text-danger">
          {`終わりの画像を読めませんでした: ${state.message}`}
        </p>
      )}
      {state.kind === 'ready' && current === null && (
        <p className="text-xs text-muted">画像を付けると、作る動画がこの絵で終わります。</p>
      )}
      {current !== null && (
        <div className="space-y-1">
          <MediaImage
            mediaAssetId={current}
            alt="終わりの画像"
            className="aspect-video w-full rounded object-cover ring-1 ring-line"
          />
          <Button size="sm" disabled={disabled || busy} onClick={detach} aria-label="終わりの画像を外す">
            外す
          </Button>
        </div>
      )}
      {state.kind === 'ready' && candidates.length > 0 && (
        <div className="space-y-1">
          <label htmlFor={pickerId} className="block text-xs text-muted">
            ほかの Shot の最初のフレームを使う
          </label>
          <select
            id={pickerId}
            value=""
            disabled={disabled || busy}
            className={INPUT_CLASS}
            onChange={(event) => {
              const picked = candidates.find((candidate) => candidate.id === event.target.value)
              if (picked !== undefined) takeStartFrameOf(picked.id)
            }}
          >
            <option value="">選んでください</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.code}
              </option>
            ))}
          </select>
        </div>
      )}
      {state.kind === 'ready' && (
        <SubPart title="画像ファイルから…">
          <ImageUploader
            id={`end-frame-${shot.id}`}
            workspaceId={workspaceId}
            submitLabel={current === null ? '終わりの画像を付ける' : '終わりの画像を付け替える'}
            disabled={disabled || busy}
            onUploaded={attach}
          />
        </SubPart>
      )}
      {error !== null && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </SubPart>
  )
}
