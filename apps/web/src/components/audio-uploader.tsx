'use client'

import { MediaKind, type MediaAssetId, type ProjectId, type WorkspaceId } from '@ixa/domain'
import { useState } from 'react'
import { FIELD_LABEL_CLASS } from '@/components/form/field-styles'
import { Button } from '@/components/ui/button'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { sha256Hex } from '@/lib/checksum'
import { WEB_UPLOADER } from '@/lib/upload-api'
import { runUploadStage, uploadStageLabel, UploadError } from '@/lib/upload-error'
import {
  AUDIO_ACCEPT,
  deriveTrackTitle,
  formatBytes,
  formatPercent,
  uploadPhaseLabel,
  uploadProgressRatio,
  validateAudioFile,
  type UploadPhase,
} from '@/lib/music-upload'

/**
 * 音源をストレージへ送り、MediaAsset として取り込むところまでを担う。
 *
 * `image-uploader.tsx` と同じ 3 段階（署名 → PUT → 完了通知）だが、
 * **本物の音源は 33MB ある**。`fetch` は送信の途中経過を教えてくれないため、
 * PUT だけ `XMLHttpRequest` で行い、送ったバイト数を進捗として出す。
 * 署名と完了通知は `UploadApi` をそのまま呼ぶので、経路とスキーマの正は 1 箇所のまま。
 */

/** ブラウザが MIME を判定できなかったときの既定値。 */
const FALLBACK_CONTENT_TYPE = 'application/octet-stream'

/** ストレージのエラー本文をそのまま流し込まないための上限。 */
const STORAGE_ERROR_BODY_LIMIT = 300

const SUCCESS_STATUS_MIN = 200
const SUCCESS_STATUS_MAX = 300

export type UploadedAudio = {
  readonly mediaAssetId: MediaAssetId
  readonly fileName: string
  readonly bytes: number
  /** ファイル名から作った曲名の初期値。利用者は書き換えられる。 */
  readonly suggestedTitle: string
}

export type AudioUploaderProps = {
  readonly id: string
  readonly workspaceId: WorkspaceId
  readonly projectId: ProjectId
  readonly disabled?: boolean
  /** 取り込みが終わった音源を受け取る。楽曲として登録するのは呼び出し側。 */
  readonly onUploaded: (uploaded: UploadedAudio) => void
}

/**
 * 署名付き URL でストレージへ直接送る。
 * URL はここでも state にもエラー文にも残さない（CLAUDE.md 規約 7）。
 */
const putWithProgress = (
  uploadUrl: string,
  file: File,
  contentType: string,
  onSent: (bytes: number) => void,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('PUT', uploadUrl)
    request.setRequestHeader('content-type', contentType)

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onSent(event.loaded)
    })

    request.addEventListener('load', () => {
      if (request.status >= SUCCESS_STATUS_MIN && request.status < SUCCESS_STATUS_MAX) {
        resolve()
        return
      }
      const body = request.responseText.slice(0, STORAGE_ERROR_BODY_LIMIT)
      reject(
        new UploadError('upload', `ストレージが ${String(request.status)} を返しました — ${body}`),
      )
    })

    request.addEventListener('error', () => {
      reject(new UploadError('upload', 'ストレージへ接続できませんでした'))
    })

    request.addEventListener('abort', () => {
      reject(new UploadError('upload', '送信が中断されました'))
    })

    request.send(file)
  })

export const AudioUploader = ({
  id,
  workspaceId,
  projectId,
  disabled = false,
  onUploaded,
}: AudioUploaderProps) => {
  const [file, setFile] = useState<File | null>(null)
  const [phase, setPhase] = useState<UploadPhase>('idle')
  const [sentBytes, setSentBytes] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // 入力欄を捨てるために付け替える key。DOM を直接いじらずに選択状態を初期化する。
  const [inputGeneration, setInputGeneration] = useState(0)

  const busy = phase !== 'idle' && phase !== 'done'
  const ratio = uploadProgressRatio({ phase, sentBytes, totalBytes: file?.size ?? 0 })

  const upload = async (target: File): Promise<void> => {
    setError(null)
    setSentBytes(0)
    const contentType = target.type === '' ? FALLBACK_CONTENT_TYPE : target.type

    try {
      const api = createApiClient()

      setPhase('sign')
      const signed = await runUploadStage('sign', () =>
        api.signUpload({
          workspaceId,
          projectId,
          kind: MediaKind.enum.audio,
          fileName: target.name,
          contentType,
          bytes: target.size,
        }),
      )

      setPhase('upload')
      await putWithProgress(signed.uploadUrl, target, contentType, setSentBytes)

      setPhase('checksum')
      const checksumSha256 = await runUploadStage('complete', async () =>
        sha256Hex(await target.arrayBuffer()),
      )

      setPhase('complete')
      const asset = await runUploadStage('complete', () =>
        api.completeUpload({
          mediaAssetId: signed.mediaAssetId,
          workspaceId,
          projectId,
          kind: MediaKind.enum.audio,
          storageKey: signed.storageKey,
          mimeType: contentType,
          bytes: target.size,
          checksumSha256,
          uploadedBy: WEB_UPLOADER,
        }),
      )

      setPhase('done')
      onUploaded({
        mediaAssetId: asset.id,
        fileName: target.name,
        bytes: target.size,
        suggestedTitle: deriveTrackTitle(target.name),
      })
    } catch (cause) {
      const stage = cause instanceof UploadError ? `（${uploadStageLabel(cause.stage)}）` : ''
      setError(`アップロードに失敗しました${stage}: ${describeError(cause)}`)
      setPhase('idle')
    }
  }

  const select = (chosen: File | null): void => {
    setError(null)
    setPhase('idle')
    setSentBytes(0)
    if (chosen === null) {
      setFile(null)
      return
    }
    const validation = validateAudioFile(chosen)
    if (!validation.ok) {
      setFile(null)
      setError(validation.reason)
      setInputGeneration((generation) => generation + 1)
      return
    }
    setFile(chosen)
  }

  return (
    <div className="space-y-3">
      <label htmlFor={id} className={FIELD_LABEL_CLASS}>
        音源ファイル
      </label>
      <input
        key={inputGeneration}
        id={id}
        name={id}
        type="file"
        accept={AUDIO_ACCEPT}
        disabled={disabled || busy}
        onChange={(event) => {
          select(event.target.files?.[0] ?? null)
        }}
        className="block w-full text-sm text-text file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-text"
      />

      {file !== null && (
        <p className="text-sm text-muted">
          {file.name}（{formatBytes(file.size)}）
        </p>
      )}

      <Button
        tone="primary"
        disabled={disabled || busy || file === null}
        onClick={() => {
          if (file === null) return
          void upload(file)
        }}
      >
        {busy ? 'アップロード中…' : 'アップロード'}
      </Button>

      {phase !== 'idle' && (
        <div role="status" className="space-y-1">
          <p className="text-sm text-text">
            {uploadPhaseLabel(phase)}
            {phase === 'upload' && file !== null
              ? ` — ${formatBytes(sentBytes)} / ${formatBytes(file.size)}`
              : ''}
            （{formatPercent(ratio)}）
          </p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{ width: formatPercent(ratio) }}
            />
          </div>
        </div>
      )}

      {error !== null && (
        <p role="alert" className="whitespace-pre-wrap break-words text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
