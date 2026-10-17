'use client'

import type { ThumbnailStatus } from '@ixa/domain'
import { MediaImage } from '@/components/media-image'
import { RenderFolderLocation, RenderFolderNotice, type RenderFolder } from '@/components/render-folder'
import { Button } from '@/components/ui/button'
import type { WireThumbnail } from '@/lib/thumbnail-api'

/**
 * いま書き出した 1 枚の結果と、これまでの書き出し（新しい順。ADR-0051）。
 * 終わったら名前とフォルダを開くボタンを出す（動画の書き出しと同じフォルダ・同じ口。ADR-0036）。
 */

const STATUS_LABELS: Readonly<Record<ThumbnailStatus, string>> = {
  queued: '順番を待っています…',
  rendering: '描いています…',
  done: '書き出しました',
  failed: '書き出せませんでした',
}

/** いまの 1 枚の様子の文。失敗なら残された理由そのもの（無ければ決まった文）。 */
export const currentExportMessage = (thumbnail: Pick<WireThumbnail, 'status' | 'error'>): string =>
  thumbnail.status === 'failed' && thumbnail.error !== null ? thumbnail.error : STATUS_LABELS[thumbnail.status]

const OpenInFolder = ({ folder, thumbnail }: { readonly folder: RenderFolder; readonly thumbnail: WireThumbnail }) =>
  folder.canOpen && thumbnail.status === 'done' ? (
    <Button size="sm" disabled={folder.opening} onClick={() => folder.open({ thumbnailId: thumbnail.id })}>
      フォルダで見る
    </Button>
  ) : null

export const CurrentExport = ({ thumbnail, folder }: { readonly thumbnail: WireThumbnail; readonly folder: RenderFolder }) => (
  <div
    role={thumbnail.status === 'failed' ? 'alert' : 'status'}
    className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3"
  >
    {/* 失敗の文は worker が決まった日本語で 1 文だけ書く。前置きを重ねず、それだけを出す。 */}
    <p className={`text-sm ${thumbnail.status === 'failed' ? 'text-danger' : 'text-text'}`}>
      {currentExportMessage(thumbnail)}
    </p>
    {thumbnail.status === 'done' && <p className="break-all text-xs text-muted">{thumbnail.fileName}</p>}
    <OpenInFolder folder={folder} thumbnail={thumbnail} />
  </div>
)

export const ThumbnailExportList = ({
  list,
  error,
  folder,
}: {
  readonly list: readonly WireThumbnail[] | null
  readonly error: string | null
  readonly folder: RenderFolder
}) => (
  <section aria-label="これまでのサムネイル" className="flex flex-col gap-2">
    <h3 className="text-sm font-semibold text-text">これまでのサムネイル</h3>
    <RenderFolderLocation folder={folder} />
    <RenderFolderNotice folder={folder} />
    {error !== null && (
      <p role="alert" className="text-xs text-danger">
        {error}
      </p>
    )}
    {list === null && error === null && <p className="text-xs text-muted">読み込んでいます…</p>}
    {list !== null && list.length === 0 && <p className="text-xs text-muted">まだ書き出していません。</p>}
    {list !== null && list.length > 0 && (
      <ul className="grid grid-cols-2 gap-2">
        {list.map((thumbnail) => (
          <li key={thumbnail.id} className="flex flex-col gap-1 rounded border border-line bg-surface p-1">
            {thumbnail.outputAssetId === null ? (
              <div className="flex aspect-video w-full items-center justify-center rounded bg-surface-2">
                <span className="text-xs text-muted">{STATUS_LABELS[thumbnail.status]}</span>
              </div>
            ) : (
              <MediaImage
                mediaAssetId={thumbnail.outputAssetId}
                alt={thumbnail.spec.title}
                className="aspect-video w-full rounded object-cover"
              />
            )}
            <span className="truncate text-xs text-muted" title={thumbnail.fileName}>
              {thumbnail.fileName}
            </span>
            <OpenInFolder folder={folder} thumbnail={thumbnail} />
          </li>
        ))}
      </ul>
    )}
  </section>
)
