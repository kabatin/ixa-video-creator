'use client'

import { createContext, useContext } from 'react'

/**
 * 再生位置（秒）。**毎コマ変わるので、読むのは位置を描く末端の部品だけにする。**
 *
 * 位置を props で配ると、受け取った部品の下が毎コマ丸ごと描き直される。タイムラインでは
 * 数百の部品が 1 秒に数十回描き直され、主スレッドが詰まってプレビューの音が巻き戻った
 * （2026-09-28 実測）。再生ヘッドの線や時刻の表示のように、位置そのものを描く部品だけが読む。
 *
 * 持ち主は、ワークベンチでは `WorkbenchTransportProvider`、単独のタイムラインでは `TimelineEditor` 自身。
 */
export const PlayheadSecContext = createContext<number | null>(null)
PlayheadSecContext.displayName = 'PlayheadSecContext'

export const usePlayheadSec = (): number => {
  const value = useContext(PlayheadSecContext)
  // 0 で黙って続けない。持ち主の無い位置は「先頭にいる」と区別できない。
  if (value === null) throw new Error('再生位置を読む部品が、位置を配る部品の外にあります')
  return value
}
