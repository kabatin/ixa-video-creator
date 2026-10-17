'use client'

import type { ThumbnailSpec, TimelineDocument } from '@ixa/domain'
import type { ThumbnailCompositionProps } from '@ixa/render/composition'
import dynamic from 'next/dynamic'
import { useMemo } from 'react'
import { useMediaUrl } from '@/components/thumbnail/use-media-url'

/**
 * サムネイルのプレビュー（ADR-0051）。書き出しと同じ `ThumbnailComposition` を `@remotion/player` で描く。
 * 背景の材料は書き出しと同じ物を渡す: タイムラインのコマなら書き出しの画面が読むのと同じ TimelineDocument、
 * 画像なら素材の URL（worker も描く直前に同じ素材の URL を発行する）。
 */

const ThumbnailPlayer = dynamic(
  () => import('@/components/thumbnail/thumbnail-player').then((mod) => mod.ThumbnailPlayer),
  { ssr: false, loading: () => <PreviewMessage message="プレビューを準備しています。" /> },
)

const PreviewMessage = ({ message, alert = false }: { readonly message: string; readonly alert?: boolean }) => (
  <div className="flex aspect-video w-full shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 p-4">
    <p role={alert ? 'alert' : 'status'} className={`text-sm ${alert ? 'text-danger' : 'text-muted'}`}>
      {message}
    </p>
  </div>
)

export type ThumbnailPreviewProps = {
  /** null は「背景を選んでいない・入力が描ける形でない」。 */
  readonly spec: ThumbnailSpec | null
  /** null は「読めていない」。 */
  readonly timeline: TimelineDocument | null
  readonly timelineError: string | null
}

export const ThumbnailPreview = ({ spec, timeline, timelineError }: ThumbnailPreviewProps) => {
  const imageId = spec?.background.kind === 'image' ? spec.background.mediaAssetId : null
  const image = useMediaUrl(imageId)

  const props = useMemo((): ThumbnailCompositionProps | null => {
    if (spec === null) return null
    if (spec.background.kind === 'timeline_frame') {
      return timeline === null ? null : { spec, source: { kind: 'timeline_frame', doc: timeline } }
    }
    return image.kind === 'ready' ? { spec, source: { kind: 'image', url: image.url } } : null
  }, [spec, timeline, image])

  if (spec === null) return <PreviewMessage message="背景を選ぶと、ここに書き出す 1 枚がそのまま出ます。" />
  if (spec.background.kind === 'timeline_frame' && timeline === null) {
    return timelineError === null ? (
      <PreviewMessage message="タイムラインを読み込んでいます…" />
    ) : (
      <PreviewMessage alert message={timelineError} />
    )
  }
  if (image.kind === 'error') return <PreviewMessage alert message={`画像を読み込めませんでした: ${image.message}`} />
  if (props === null) return <PreviewMessage message="画像を読み込んでいます…" />
  // 見本は縮めない。下の一覧が伸びると、縦に流れる列の中で潰れていた。
  return (
    <div className="shrink-0 overflow-hidden rounded-md border border-line bg-black">
      <ThumbnailPlayer props={props} />
    </div>
  )
}
