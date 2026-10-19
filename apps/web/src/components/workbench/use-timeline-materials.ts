'use client'

import { useEffect, useState } from 'react'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { loadTimelineMaterials, type TimelineMaterials } from '@/lib/timeline-loader'
import { timelineShotsKey } from '@/lib/timeline-shots-key'

/**
 * タイムラインの材料（`timeline-loader.ts`）。タイムラインと検査のタブが**それぞれ自分で取る**（UI-WORKBENCH §7.3）。
 *
 * 開いたとき・サーバから読み直したとき・Take ができたとき・Shot の尺や採用を変えたとき・
 * ナレーションが変わったとき（声・位置・テロップ）・`extraEpoch` が進んだとき（効果音を置いた等）に取り直す。
 * 読み込み中は null。
 */
export const useTimelineMaterials = (extraEpoch = 0): TimelineMaterials | null => {
  const workbench = useWorkbench()
  const [materials, setMaterials] = useState<TimelineMaterials | null>(null)
  const shotsKey = timelineShotsKey(workbench.shots)
  useEffect(() => {
    let cancelled = false
    void loadTimelineMaterials(workbench.projectId).then((loaded) => {
      if (!cancelled) setMaterials(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [workbench.projectId, workbench.serverEpoch, workbench.posterEpoch, workbench.narrationEpoch, extraEpoch, shotsKey])
  return materials
}
