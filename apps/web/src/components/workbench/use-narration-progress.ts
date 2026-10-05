'use client'

import type { ProjectId } from '@ixa/domain'
import { useEffect, useMemo, useState } from 'react'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { createNarrationApi } from '@/lib/narration-api'
import { createRequester } from '@/lib/requester'

/**
 * 作業の流れの「ナレーション」の段（ADR-0038）の材料。行の数と、声を作って置いた行の数。
 * 読めなければ null（帯の 1 段が「分からない」になるだけ。理由はナレーションのパネルを開いたときに出る）。
 */
export const useNarrationProgress = (
  projectId: ProjectId,
  epoch: number,
): { readonly lines: number; readonly ready: number } | null => {
  const api = useMemo(() => createNarrationApi(createRequester(resolveApiBaseUrl())), [])
  const [progress, setProgress] = useState<{ readonly lines: number; readonly ready: number } | null>(null)

  useEffect(() => {
    let alive = true
    api
      .getNarration(projectId)
      .then((overview) => {
        if (!alive) return
        const ready = overview.lines.filter((line) => line.selectedTakeId !== null && line.startSec !== null).length
        setProgress({ lines: overview.lines.length, ready })
      })
      .catch(() => {
        if (alive) setProgress(null)
      })
    return () => {
      alive = false
    }
  }, [api, projectId, epoch])

  return progress
}
