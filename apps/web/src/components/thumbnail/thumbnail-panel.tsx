'use client'

import type { ProjectId, Shot, TimelineDocument } from '@ixa/domain'
import { fitThumbnailText } from '@ixa/render/composition'
import { useMemo, useState } from 'react'
import { useRenderFolder } from '@/components/render-folder'
import { BackgroundPicker } from '@/components/thumbnail/background-picker'
import { FramingFields, TextFields } from '@/components/thumbnail/thumbnail-fields'
import { CurrentExport, ThumbnailExportList } from '@/components/thumbnail/thumbnail-exports'
import { ThumbnailPreview } from '@/components/thumbnail/thumbnail-preview'
import { useKeyArtJobs } from '@/components/thumbnail/use-key-art-jobs'
import { useThumbnailExport } from '@/components/thumbnail/use-thumbnail-export'
import { Button } from '@/components/ui/button'
import { resolveApiBaseUrl } from '@/lib/api-client'
import type { RenderFolderApi } from '@/lib/render-folder-api'
import { createRequester } from '@/lib/requester'
import type { ShotPosterMap } from '@/lib/shot-posters'
import { createThumbnailApi, type ThumbnailApi } from '@/lib/thumbnail-api'
import { checkThumbnailForm, initialThumbnailForm, previewSpec, type ThumbnailForm } from '@/lib/thumbnail-form'

/**
 * サムネイルを書き出す（ADR-0051）。左で背景・寄せ方・文字を決め、右に書き出す 1 枚そのものを出す。
 * 「書き出す」で worker が同じ部品で JPEG を描き、動画と同じ書き出しフォルダに入る。
 */

export type ThumbnailPanelProps = {
  readonly projectId: ProjectId
  /** 題名の初期値（作品名）。 */
  readonly defaultTitle: string
  readonly shots: readonly Shot[]
  readonly posters: ShotPosterMap
  /** プレビューのタイムラインの文書。null は「読めていない」。 */
  readonly timeline: TimelineDocument | null
  readonly timelineError: string | null
  /** テストから差し替えるための注入口。 */
  readonly api?: ThumbnailApi
  readonly folderApi?: RenderFolderApi
}

const defaultApi = (): ThumbnailApi => createThumbnailApi(createRequester(resolveApiBaseUrl()))

export const ThumbnailPanel = ({
  projectId,
  defaultTitle,
  shots,
  posters,
  timeline,
  timelineError,
  api,
  folderApi,
}: ThumbnailPanelProps) => {
  const client = useMemo(() => api ?? defaultApi(), [api])
  const folder = useRenderFolder(projectId, folderApi)
  const exporting = useThumbnailExport(projectId, client)
  const keyArt = useKeyArtJobs(projectId, client)
  const [form, setForm] = useState<ThumbnailForm>(() => initialThumbnailForm(defaultTitle))
  const [messages, setMessages] = useState<readonly string[]>([])

  const update = (patch: Partial<ThumbnailForm>): void => {
    setForm((before) => ({ ...before, ...patch }))
    setMessages([])
  }
  const spec = useMemo(() => previewSpec(form), [form])
  // 「自動」の大きさは、プレビューが描く大きさと同じ計算で見せる。
  const autoSizes = useMemo(() => {
    if (spec === null) return null
    // 片方だけを自動にしたときの大きさ。もう片方は決めた値のまま（副題の自動は題名の大きさで変わる）。
    const title = fitThumbnailText({ ...spec, titleSize: null }).title.size
    const subtitle = fitThumbnailText({ ...spec, subtitleSize: null }).subtitle?.size ?? null
    return { title, subtitle }
  }, [spec])
  // 追いかけている間だけ押せない（諦めたら押せる。`use-thumbnail-export.ts`）。
  const busy = exporting.busy

  const submit = (): void => {
    const check = checkThumbnailForm(form)
    if (!check.ok) {
      setMessages(check.messages)
      return
    }
    exporting.start(check.spec)
  }

  return (
    <div className="grid gap-6 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
      <section aria-label="サムネイルの中身" className="flex flex-col gap-5 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
        <BackgroundPicker
          background={form.background}
          onChange={(background) => update({ background })}
          shots={shots}
          posters={posters}
          keyArt={keyArt}
        />
        <FramingFields form={form} onChange={update} />
        <TextFields form={form} onChange={update} autoSizes={autoSizes} />
      </section>

      <section aria-label="プレビュー" className="flex flex-col gap-4 lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-line lg:pl-6">
        <ThumbnailPreview spec={spec} timeline={timeline} timelineError={timelineError} />
        <div className="flex flex-col gap-2">
          <div className="grid">
            <Button tone="primary" disabled={busy} onClick={submit}>
              {busy ? '書き出しています…' : '書き出す'}
            </Button>
          </div>
          <p className="text-xs text-muted">YouTube の大きさ（横長）の JPEG を、動画と同じ書き出しフォルダに入れます。</p>
          {messages.map((message) => (
            <p key={message} role="alert" className="text-sm text-danger">
              {message}
            </p>
          ))}
          {exporting.problem !== null && (
            <p role="alert" className="text-sm text-danger">
              {exporting.problem}
            </p>
          )}
          {exporting.note !== null && (
            <p role="status" className="text-sm text-warn">
              {exporting.note}
            </p>
          )}
          {exporting.current !== null && <CurrentExport thumbnail={exporting.current} folder={folder} />}
        </div>
        <ThumbnailExportList list={exporting.list} error={exporting.listError} folder={folder} />
      </section>
    </div>
  )
}
