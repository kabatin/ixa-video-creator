'use client'

import type { ImageGenerationJobId, MediaAssetId } from '@ixa/domain'
import { useState } from 'react'
import { ImageCheckBadge } from '@/components/image-check-badge'
import { MediaImage } from '@/components/media-image'
import { Button } from '@/components/ui/button'
import { PromptButton } from '@/components/prompt/prompt-button'
import { imageCheckReason, type WireImageHistoryEntry } from '@/lib/image-check'
import { promptViewFromImageJob } from '@/lib/prompt-view'

/**
 * 開始フレームとして作った絵の履歴の帯（ADR-0055）。作った順にサムネイルを並べ、チェックの印と理由を付ける。
 * 押すと拡大し、「これを使う」でその絵に替える（`PUT /shots/{id}/start-frame` なので ⌘Z で戻る）。
 * 「やり直す」は同じ AI で描き直す（利用枠を使う AI では自動でやり直さないため、人が押す口）。
 */

export type StartFrameHistoryProps = {
  /** プロンプトの見出しに使う Shot の番号。省けば何枚目かだけ。 */
  readonly shotCode?: string
  readonly entries: readonly WireImageHistoryEntry[]
  /** 押せない（作っている最中・保存中）。 */
  readonly disabled: boolean
  readonly onUse: (mediaAssetId: MediaAssetId) => void
  readonly onRetry: (jobId: ImageGenerationJobId) => void
}

type Drawn = WireImageHistoryEntry & { readonly mediaAssetId: MediaAssetId }

const drawnOf = (entries: readonly WireImageHistoryEntry[]): readonly Drawn[] =>
  [...entries]
    .flatMap((entry) => (entry.mediaAssetId === null ? [] : [{ ...entry, mediaAssetId: entry.mediaAssetId }]))
    .sort((a, b) => a.queuedAt.getTime() - b.queuedAt.getTime())

export const StartFrameHistory = ({ shotCode, entries, disabled, onUse, onRetry }: StartFrameHistoryProps) => {
  const drawn = drawnOf(entries)
  const [openJobId, setOpenJobId] = useState<ImageGenerationJobId | null>(null)
  const open = drawn.find((entry) => entry.jobId === openJobId) ?? null
  const openNumber = open === null ? 0 : drawn.indexOf(open) + 1
  const openTitle = `${shotCode === undefined ? '' : `${shotCode} の`}開始画像（${String(openNumber)} 枚目）`
  if (drawn.length === 0) return null

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted">作った絵の履歴</p>
      <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="作った絵の履歴">
        {drawn.map((entry, index) => (
          <li key={entry.jobId} className="w-24 shrink-0 space-y-1">
            <button
              type="button"
              aria-pressed={entry.jobId === openJobId}
              aria-label={`${String(index + 1)} 枚目を拡大する`}
              title={imageCheckReason(entry.check) ?? undefined}
              className={`block w-full rounded border p-0.5 ${
                entry.current ? 'border-accent' : entry.jobId === openJobId ? 'border-line-strong' : 'border-line'
              }`}
              onClick={() => setOpenJobId(entry.jobId === openJobId ? null : entry.jobId)}
            >
              <MediaImage
                mediaAssetId={entry.mediaAssetId}
                alt={`${String(index + 1)} 枚目`}
                className="aspect-video w-full rounded object-cover"
              />
            </button>
            <div className="flex flex-wrap items-center gap-1">
              <ImageCheckBadge check={entry.check} />
              {entry.current && <span className="text-xs text-accent">使用中</span>}
            </div>
          </li>
        ))}
      </ul>
      {open !== null && (
        <div className="space-y-2 rounded border border-line p-2">
          <MediaImage
            mediaAssetId={open.mediaAssetId}
            alt="拡大した絵"
            className="aspect-video w-full rounded object-contain ring-1 ring-line"
          />
          <div className="flex flex-wrap items-center gap-2">
            <ImageCheckBadge check={open.check} />
            {open.attempt > 1 && <span className="text-xs text-muted">{`やり直し ${String(open.attempt - 1)} 回目`}</span>}
            <PromptButton view={promptViewFromImageJob(open, openTitle)} />
          </div>
          {imageCheckReason(open.check) !== null && <p className="text-xs text-text">{imageCheckReason(open.check)}</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" tone="primary" disabled={disabled || open.current} onClick={() => onUse(open.mediaAssetId)}>
              {open.current ? '使っています' : 'これを使う'}
            </Button>
            <Button size="sm" disabled={disabled} onClick={() => onRetry(open.jobId)}>
              やり直す
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
