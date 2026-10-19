'use client'

import type { Shot } from '@ixa/domain'
import { useEffect, useMemo, useState } from 'react'
import { createApiClient } from '@/lib/api-client'
import { motionMarksOf, type MotionMark } from '@/lib/timeline-motion-marks'

/**
 * 採用中の Take がある Shot の動きの分析を読み、タイムラインの印にする（ADR-0054）。
 * **ここでは分析を頼まない**（頼むのは「効果音を作る」窓）。読めなかった Shot は印を出さないだけで、
 * タイムラインは止めない（目安の表示なので）。`version` が変わったら読み直す（窓を閉じたときなど）。
 */
export const useTimelineMotionMarks = (shots: readonly Shot[] | null, version: unknown): readonly MotionMark[] => {
  const client = useMemo(() => createApiClient(), [])
  const [marks, setMarks] = useState<readonly MotionMark[]>([])
  // Shot の位置・採用が変わったときだけ読み直す（一覧の作り直しごとには読まない）。
  const key = (shots ?? [])
    .filter((shot) => shot.selectedTakeId !== null)
    .map((shot) => `${shot.id}:${String(shot.selectedTakeId)}:${String(shot.startSec)}:${String(shot.durationSec)}:${String(shot.speed)}:${String(shot.sourceInSec)}`)
    .join('|')

  useEffect(() => {
    let alive = true
    const ids = key === '' ? [] : key.split('|').map((part) => part.split(':')[0] as Shot['id'])
    void Promise.all(ids.map((id) => client.getShotMotion(id).catch(() => null))).then((motions) => {
      if (alive) setMarks(motionMarksOf(motions.flatMap((motion) => (motion === null ? [] : [motion]))))
    })
    return () => {
      alive = false
    }
  }, [client, key, version])

  return marks
}
