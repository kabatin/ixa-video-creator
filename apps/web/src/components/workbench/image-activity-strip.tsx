'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

/**
 * 絵を作っている数と、まとめて止める口（制作者 2026-10-04「いま30個ぐらいキューに入ってる画像生成とめたい」）。
 * 一括で絵を作ると順番待ちが長く残る。以前は止める口が無かった。
 * **同時に何枚作るかはここに書かない。** worker の設定（`WORKER_CONCURRENCY_IMAGE`）で変わるので、
 * 書き写すと片方だけ直る日が来る（以前「1 枚ずつ」と書いたまま同時 3 枚になっていた）。
 * 止めると作品の絵（キャラクターシートも）をすべて止める。作っている途中の 1 枚は、届いても差し替えない。
 */
export const ImageActivityStrip = ({
  drawingCount,
  onStopAll,
}: {
  readonly drawingCount: number
  readonly onStopAll: () => Promise<void>
}) => {
  const [stopping, setStopping] = useState(false)
  if (drawingCount === 0) return null
  return (
    <p role="status" className="flex flex-wrap items-center gap-2 border-b border-line px-2 py-1 text-xs text-text">
      <span>{`絵を作っています（${String(drawingCount)} 件）。順番に作ります。`}</span>
      <Button
        size="sm"
        nowrap
        disabled={stopping}
        onClick={() => {
          setStopping(true)
          void onStopAll().finally(() => {
            setStopping(false)
          })
        }}
      >
        すべてやめる
      </Button>
    </p>
  )
}
