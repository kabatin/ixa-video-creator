'use client'

import type { ProjectId, Shot, Take, WorkspaceId } from '@ixa/domain'
import { useId, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { INPUT_CLASS } from '@/components/workbench/ui/section'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import { importFootageFiles, type FootageImportApi } from '@/lib/footage-api'
import { uploadStageLabel, UploadError } from '@/lib/upload-error'

/**
 * 手持ちの動画をこの Shot の Take にする（ADR-0026）。
 *
 * インスペクターの Take 欄と、Shot を見ているときの動画ドロップが同じ形を使う。
 * 作ったモデルは任意（分からなければ空のまま。推定なら「（推定）」と書けばそのまま残る）。
 * 採用はしない。比べて選ぶのは Take 比較。
 */
export type FootageImportFormProps = {
  readonly shot: Pick<Shot, 'id' | 'code'>
  readonly workspaceId: WorkspaceId
  readonly projectId: ProjectId
  /** 落とされた動画。渡されたらファイル選択は出さない。 */
  readonly files?: readonly File[]
  readonly disabled?: boolean
  readonly onImported?: (takes: readonly Take[]) => void
  readonly api?: FootageImportApi
}

const failureMessage = (cause: unknown): string => {
  const stage = cause instanceof UploadError ? `（${uploadStageLabel(cause.stage)}）` : ''
  return `取り込めませんでした${stage}: ${describeForPerson(cause)}`
}

export const FootageImportForm = ({
  shot,
  workspaceId,
  projectId,
  files: givenFiles,
  disabled = false,
  onImported,
  api,
}: FootageImportFormProps) => {
  const client = useMemo<FootageImportApi>(() => api ?? createApiClient(), [api])
  const fileInputId = useId()
  const modelInputId = useId()
  const [chosen, setChosen] = useState<readonly File[]>([])
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ readonly tone: 'ok' | 'error'; readonly text: string } | null>(null)
  // 取り込み後に選択を捨てるための key。DOM を直接いじらない。
  const [inputGeneration, setInputGeneration] = useState(0)
  const files = givenFiles ?? chosen

  const run = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const trimmed = model.trim()
      const takes = await importFootageFiles(
        client,
        { shotId: shot.id, workspaceId, projectId },
        files,
        trimmed === '' ? null : trimmed,
      )
      setChosen([])
      setInputGeneration((generation) => generation + 1)
      setMessage({ tone: 'ok', text: `${String(takes.length)} 本を Take にしました。Take 比較で採用できます。` })
      onImported?.(takes)
    } catch (cause) {
      setMessage({ tone: 'error', text: failureMessage(cause) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      {givenFiles === undefined && (
        <>
          <p className="text-xs font-semibold text-muted">動画を取り込む</p>
          <p className="text-xs text-muted">他のツールで作った動画を、この Shot の Take にします。</p>
          <label htmlFor={fileInputId} className="sr-only">
            動画ファイル
          </label>
          <input
            key={inputGeneration}
            id={fileInputId}
            type="file"
            accept="video/*"
            multiple
            disabled={disabled || busy}
            onChange={(event) => {
              setMessage(null)
              setChosen([...(event.target.files ?? [])])
            }}
            className="block w-full text-sm text-text file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-text"
          />
        </>
      )}
      <label htmlFor={modelInputId} className="block text-xs text-muted">
        作ったモデル（分かれば）
      </label>
      <input
        id={modelInputId}
        type="text"
        value={model}
        maxLength={120}
        placeholder="Veo 3.1 Lite など"
        disabled={disabled || busy}
        onChange={(event) => {
          setModel(event.target.value)
        }}
        className={INPUT_CLASS}
      />
      <Button size="sm" disabled={disabled || busy || files.length === 0} onClick={() => void run()}>
        {busy ? '取り込んでいます…' : `Shot ${shot.code} の Take にする（${String(files.length)} 本）`}
      </Button>
      {message !== null && (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={`text-xs ${message.tone === 'error' ? 'text-danger' : 'text-muted'}`}
        >
          {message.text}
        </p>
      )}
    </div>
  )
}
