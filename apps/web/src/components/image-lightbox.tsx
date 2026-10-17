'use client'

import type { MediaAssetId } from '@ixa/domain'
import { useEffect } from 'react'
import { MediaImage } from '@/components/media-image'

export type LightboxItem = {
  readonly mediaAssetId: MediaAssetId
  readonly caption: string
}

/**
 * 画像を画面いっぱいに出す。**切り取らずに全体を見せる**（一覧のカードは小さい）。
 * Esc か背景で閉じ、← → で前後の画像へ移る。
 */
export const ImageLightbox = ({
  items,
  index,
  onClose,
  onMove,
}: {
  readonly items: readonly LightboxItem[]
  readonly index: number
  readonly onClose: () => void
  readonly onMove: (next: number) => void
}) => {
  const item = items[index]
  const count = items.length

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowLeft' && count > 1) onMove((index - 1 + count) % count)
      else if (event.key === 'ArrowRight' && count > 1) onMove((index + 1) % count)
      else return
      // ワークベンチのキー操作（再生・Shot の移動）へ流さない。
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
    }
  }, [count, index, onClose, onMove])

  if (item === undefined) return null
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={item.caption}
      onClick={onClose}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-2 bg-black/85 p-4"
    >
      <div
        onClick={(event) => {
          event.stopPropagation()
        }}
        className="flex max-h-full max-w-full flex-col items-center gap-2"
      >
        <MediaImage
          key={item.mediaAssetId}
          mediaAssetId={item.mediaAssetId}
          alt={item.caption}
          className="max-h-[85vh] max-w-[92vw] rounded object-contain"
        />
        <div className="flex items-center gap-3 text-sm text-white/80">
          {count > 1 && (
            <button type="button" aria-label="前の画像" onClick={() => { onMove((index - 1 + count) % count) }} className="px-2 hover:text-white">
              ←
            </button>
          )}
          <span>{count > 1 ? `${item.caption}（${String(index + 1)} / ${String(count)}）` : item.caption}</span>
          {count > 1 && (
            <button type="button" aria-label="次の画像" onClick={() => { onMove((index + 1) % count) }} className="px-2 hover:text-white">
              →
            </button>
          )}
          <button type="button" onClick={onClose} className="ml-2 rounded border border-white/40 px-2 hover:text-white">
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
