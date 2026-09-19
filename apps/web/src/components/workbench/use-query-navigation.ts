'use client'

import { useEffect, useRef } from 'react'
import { useWorkbench } from '@/components/workbench/workbench-context'
import type { WorkbenchQuery } from '@/lib/workbench-url'

/**
 * ワークベンチの中から同じワークベンチへのリンクを踏んだとき（例: 検査の指摘から Shot へ）。
 *
 * 同じページへの移動では部品が作り直されないので、`?` を一度読むだけだと**押しても何も起きない**。
 * `?` の中身が変わったときだけ、選択・タブ・ダイアログを合わせる。
 * `router.refresh()` で同じ値が届いたときは何もしない（読み直すたびにタブが動くと困る）。
 */
export const useQueryNavigation = (query: WorkbenchQuery): void => {
  const workbench = useWorkbench()
  const latest = useRef(workbench)
  latest.current = workbench
  const seen = useRef(JSON.stringify(query))

  useEffect(() => {
    const key = JSON.stringify(query)
    if (key === seen.current) return
    seen.current = key
    const current = latest.current
    if (query.shot !== null) current.selectShot(query.shot)
    ;[query.main, query.bottom, query.side].forEach((panel) => {
      if (panel !== null) current.focusPanel(panel)
    })
    // 楽曲ダイアログは無くした（UI-WORKBENCH-2 §4.4）。マスターの楽曲をインスペクターとビューアで開く。
    if (query.dialog === 'music') {
      current.closeDialog()
      if (current.track !== null) {
        current.inspect({ kind: 'track', id: current.track.id })
        current.openViewer()
      }
    } else if (query.dialog !== null) current.openDialog(query.dialog)
    else current.closeDialog()
  }, [query])
}
