'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { loadTimelineMaterials, type TimelineMaterials } from '@/lib/timeline-loader'
import { timelineShotsKey } from '@/lib/timeline-shots-key'

/**
 * タイムラインの材料（`timeline-loader.ts`）。**ワークベンチに 1 つ。** タイムラインと検査のタブが同じものを読む。
 *
 * 別々に取っていたころは取得が 2 回走り、タイムラインだけ取り直したとき（効果音を置いた等）に
 * 検査の指摘・「検査 N」・吸着の候補が古いまま残った（レビュー 2026-10-19）。
 *
 * 取り直すのは、開いたとき・サーバから読み直したとき・Take ができたとき・Shot の尺や採用を変えたとき・
 * ナレーションが変わったとき（声・位置・テロップ）・`reload` を呼んだとき（帯のクリップを書いたあと）。
 */

export type TimelineMaterialsValue = {
  /** 読み込み中は null。 */
  readonly materials: TimelineMaterials | null
  /** 取り直す。帯のクリップを置いた・動かした・消したあとに呼ぶ。 */
  readonly reload: () => void
}

const TimelineMaterialsContext = createContext<TimelineMaterialsValue | null>(null)
TimelineMaterialsContext.displayName = 'TimelineMaterialsContext'

export const TimelineMaterialsProvider = ({ children }: { readonly children: ReactNode }) => {
  const workbench = useWorkbench()
  const [materials, setMaterials] = useState<TimelineMaterials | null>(null)
  const [epoch, setEpoch] = useState(0)
  const reload = useCallback((): void => {
    setEpoch((current) => current + 1)
  }, [])
  const shotsKey = timelineShotsKey(workbench.shots)

  useEffect(() => {
    let cancelled = false
    void loadTimelineMaterials(workbench.projectId).then((loaded) => {
      if (!cancelled) setMaterials(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [workbench.projectId, workbench.serverEpoch, workbench.posterEpoch, workbench.narrationEpoch, epoch, shotsKey])

  const value = useMemo(() => ({ materials, reload }), [materials, reload])
  return <TimelineMaterialsContext.Provider value={value}>{children}</TimelineMaterialsContext.Provider>
}

export const useTimelineMaterials = (): TimelineMaterialsValue => {
  const value = useContext(TimelineMaterialsContext)
  if (value === null) throw new Error('タイムラインの材料を読む部品が TimelineMaterialsProvider の外にあります')
  return value
}
