'use client'

import type { ProjectId } from '@ixa/domain'
import { useEffect, useMemo, useState } from 'react'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { createRequester } from '@/lib/requester'
import { createTimelineApi } from '@/lib/timeline-api'
import { lyricTelopCountOf } from '@/lib/workflow-steps'

/**
 * 歌詞から置いたテロップの数（流れの帯の「テロップ」の段）。サーバを読み直したら（`epoch`）数え直す。
 * **読めないうちと読めなかったときは null**（0 件と混ぜない。L-015）。
 */
export const useLyricTelopCount = (projectId: ProjectId, epoch: number): number | null => {
  const api = useMemo(() => createTimelineApi(createRequester(resolveApiBaseUrl())), [])
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    api
      .listClips(projectId, 'TEXT')
      .then((clips) => {
        if (alive) setCount(lyricTelopCountOf(clips))
      })
      .catch(() => {
        // 帯の 1 段が「分からない」になるだけ。理由はタイムラインを開いたときに出る（同じ口を読む）。
        if (alive) setCount(null)
      })
    return () => {
      alive = false
    }
  }, [api, projectId, epoch])

  return count
}
