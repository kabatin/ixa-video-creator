'use client'

import type { ImageGenerationJobId, MediaAssetId, Shot, ShotId, WorkspaceId } from '@ixa/domain'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ImageUploader } from '@/components/image-uploader'
import { MediaImage } from '@/components/media-image'
import { Button } from '@/components/ui/button'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import { imageJobProgressText, isImageJobActive, type ImageCheckApi, type WireStartFrameHistory } from '@/lib/image-check'
import type { ShotStartFrameApi, WireStartFrameState } from '@/lib/shot-start-frame-api'
import { DRAW_ANYWAY_LABEL, drawWithoutStoryboardWarning } from '@/lib/step-guards'
import { useContextMenuHost } from '@/components/workbench/ui/context-menu'
import { StartFrameHistory } from '@/components/workbench/inspector/start-frame-history'
import { PromptButton } from '@/components/prompt/prompt-button'
import { promptViewFromImageJob } from '@/lib/prompt-view'

/**
 * Shot の最初のフレーム（ADR-0025）。
 *
 * 画像を 1 枚付けると、生成のモデル「画像から動画（ローカル・無料）」で Take にできる。
 * 他のツールで作った絵や撮った写真を、そのまま Take・採用・レビューの流れに載せる口。
 * **「まだ読めていない」と「付いていない」を混ぜない**（L-015）。
 *
 * 絵コンテの画像を AI で作ることもできる（ADR-0029）。作るのは worker で 1 枚 1 分ほど。
 * できたら出来事が届いて `version` が変わり、読み直して差し替わる。作っている間と失敗は直近のジョブで言う。
 *
 * 作った絵はチェックされ（ADR-0055）、手元の AI なら自動でやり直す。作った絵は履歴の帯に並び、選び直せる。
 */

type Job = WireStartFrameState['job']

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly mediaAssetId: MediaAssetId | null; readonly job: Job }
  | { readonly kind: 'error'; readonly message: string }

const isDrawing = (job: Job): boolean => isImageJobActive(job?.status)

/** 履歴とやり直しの口（ADR-0055）。渡さなければ履歴を出さない。 */
type HistoryApi = Partial<Pick<ImageCheckApi, 'getStartFrameHistory' | 'retryImage'>>

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
  readonly api?: ShotStartFrameApi & HistoryApi
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
  const host = useContextMenuHost()
  const client = useMemo<ShotStartFrameApi & HistoryApi>(() => api ?? createApiClient(), [api])
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [history, setHistory] = useState<WireStartFrameHistory | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadedShotId = useRef<ShotId | null>(null)

  useEffect(() => {
    let alive = true
    // 「読み込んでいます」にするのは別の Shot に移ったときだけ。同じ Shot の読み直し（`version`）は今の絵を出したまま差し替える。
    // サムネイルを作っている間は 3 秒ごとに `version` が進み、そのたびに絵を外してちらついていた（制作者 2026-10-05）。
    if (loadedShotId.current !== shot.id) setState({ kind: 'loading' })
    loadedShotId.current = shot.id
    client
      .getStartFrame(shot.id)
      .then((current) => {
        if (alive) setState({ kind: 'ready', mediaAssetId: current.mediaAssetId, job: current.job })
      })
      .catch((cause: unknown) => {
        if (alive) setState({ kind: 'error', message: describeForPerson(cause) })
      })
    // 履歴は上乗せ。読めなくても最初のフレームの欄は使える（帯を出さないだけで、欄の失敗にはしない）。
    client
      .getStartFrameHistory?.(shot.id)
      .then((loaded) => {
        if (alive) setHistory(loaded)
      })
      .catch(() => {
        if (alive) setHistory(null)
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

  /** 履歴の絵に替える（`PUT` なので取り消しの記録が付き、⌘Z で戻る）。 */
  const pickFromHistory = (mediaAssetId: MediaAssetId): void => {
    setBusy(true)
    setError(null)
    void attach(mediaAssetId)
      .then(async () => {
        const loaded = await client.getStartFrameHistory?.(shot.id)
        if (loaded !== undefined) setHistory(loaded)
      })
      .catch((cause: unknown) => setError(`替えられませんでした: ${describeForPerson(cause)}`))
      .finally(() => setBusy(false))
  }

  /** 同じ AI でやり直す（ADR-0055）。頼めたら「作っています」にする。 */
  const retry = (jobId: ImageGenerationJobId): void => {
    const retryImage = client.retryImage
    if (retryImage === undefined) return
    setBusy(true)
    setError(null)
    void retryImage(jobId)
      .then(({ jobId: started }) => {
        setState((previous) =>
          previous.kind === 'ready'
            ? { ...previous, job: { id: started, status: 'queued', error: null, attempt: (job?.attempt ?? 1) + 1 } }
            : previous,
        )
      })
      .catch((cause: unknown) => setError(`やり直しを頼めませんでした: ${describeForPerson(cause)}`))
      .finally(() => setBusy(false))
  }

  /** 作っている絵を止め、状態を読み直す（止めた後は「止めました」と出す）。 */
  const stopDrawing = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await client.cancelImages(shot.projectId, [shot.id])
      const latest = await client.getStartFrame(shot.id)
      setState({ kind: 'ready', mediaAssetId: latest.mediaAssetId, job: latest.job })
    } catch (cause) {
      setError(`止められませんでした: ${describeForPerson(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  /**
   * 絵コンテ（説明）が空なら、作る前に確かめる（制作者 2026-10-03「絵コンテがないと想定した画像が出て来ない可能性が高い」）。
   * 止めはしない。「このまま作る」を選べば作る。
   */
  const askToDraw = (): void => {
    const warning = drawWithoutStoryboardWarning([shot])
    if (warning === null) {
      void draw()
      return
    }
    host.perform({
      kind: 'item',
      id: 'draw-start-frame',
      label: '絵を作る',
      disabledReason: null,
      confirm: warning,
      confirmTone: 'primary',
      confirmLabel: DRAW_ANYWAY_LABEL,
      run: draw,
    })
  }

  /** AI で作る。頼めたら「作っています」にし、できあがりは出来事で読み直す。 */
  const draw = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const { jobId } = await client.generateStartFrame(shot.id)
      setState((previous) =>
        previous.kind === 'ready' ? { ...previous, job: { id: jobId, status: 'queued', error: null, attempt: 1 } } : previous,
      )
    } catch (cause) {
      setError(`頼めませんでした: ${describeForPerson(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  // いま付いている絵を作ったジョブ（履歴の「使用中」）。手で付けた絵は AI で作っていないので、プロンプトを出さない。
  const currentEntry = history?.items.find((entry) => entry.current) ?? null
  const currentPrompt = currentEntry === null ? null : promptViewFromImageJob(currentEntry, `${shot.code} の開始画像`)

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
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={disabled || busy} onClick={() => void detach()}>
              外す
            </Button>
            <PromptButton view={currentPrompt} />
          </div>
        </div>
      )}
      {state.kind === 'ready' && (
        <Button size="sm" disabled={disabled || busy || drawing} onClick={askToDraw}>
          {current === null ? 'AI で絵を作る' : 'AI で作り直す'}
        </Button>
      )}
      {drawing && (
        <p role="status" className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>{`${imageJobProgressText(job, history?.maxRetries ?? null, '絵コンテの画像') ?? ''}（1 枚 1 分ほど）。できたら、ここに出ます。`}</span>
          {/* 止める（制作者 2026-10-04「画像生成も停められるようにしよう」）。この Shot の絵だけ。 */}
          <Button size="sm" nowrap disabled={busy} onClick={() => void stopDrawing()} aria-label="絵を作るのをやめる">
            やめる
          </Button>
        </p>
      )}
      {job?.status === 'cancelled' && <p className="text-xs text-muted">絵を作るのを止めました。</p>}
      {job?.status === 'failed' && (
        <p role="alert" className="text-xs text-danger">
          {`絵を作れませんでした: ${job.error ?? '理由が届きませんでした。'}`}
        </p>
      )}
      {history !== null && (
        <StartFrameHistory
          shotCode={shot.code}
          entries={history.items}
          disabled={disabled || busy || drawing}
          onUse={pickFromHistory}
          onRetry={retry}
        />
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
