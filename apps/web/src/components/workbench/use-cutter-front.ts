'use client'

import { useEffect, useRef } from 'react'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { shouldFrontCutter } from '@/lib/workbench-layout'

/**
 * 聴きながら切るを前に出す（判定は `shouldFrontCutter`）。既定はタイムラインが前。
 *
 * - 開いた時点で楽曲があって Shot が 0 件
 * - 開いたあとでマスターの楽曲が決まった・替わった
 *
 * `ready` はドックを置き終えたか。置く前に頼むと、保存した配置を戻す前の空のドックに足してしまう。
 * URL で下の区画のタブを指定されたとき（`skipInitial`）は、開いた時点の判定をしない。
 */
export const useCutterFront = (ready: boolean, skipInitial: boolean): void => {
  const workbench = useWorkbench()
  const trackId = workbench.track?.id ?? null
  const shotCount = workbench.shots?.length ?? null
  /** 前に見た楽曲。undefined は「まだ判定していない（開いた時点）」。 */
  const previousTrackId = useRef<string | null | undefined>(undefined)
  /**
   * 判定の材料のうち、変わっても判定し直さないもの。
   * Shot の数が変わっただけで聴きながら切るへ飛ばさない（Shot を作った直後に前のタブが替わる）。
   */
  const latest = useRef({ shotCount, skipInitial, focusPanel: workbench.focusPanel })
  useEffect(() => {
    latest.current = { shotCount, skipInitial, focusPanel: workbench.focusPanel }
  })

  useEffect(() => {
    if (!ready) return
    const previous = previousTrackId.current
    previousTrackId.current = trackId
    const { shotCount: count, skipInitial: skip, focusPanel } = latest.current
    if (previous === undefined && skip) return
    if (shouldFrontCutter({ previousTrackId: previous, trackId, shotCount: count })) focusPanel('cutter')
  }, [ready, trackId])
}
