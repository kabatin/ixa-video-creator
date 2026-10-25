'use client'

import type { MusicTrackId } from '@ixa/domain'
import { useEffect, useMemo, useState } from 'react'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { createApiClient } from '@/lib/api-client'
import type { MusicSourceApi, WireMusicTrackSource } from '@/lib/music-source-api'

const NONE: ReadonlyMap<MusicTrackId, WireMusicTrackSource> = new Map()

/**
 * AI で作った曲の頼み方（プロンプトビューア）。曲ができるたびに読み直す。
 * 読めない間・読めなかったときは空（プロンプトのボタンと右クリックの項目が出ないだけ。曲は聴ける）。
 */
export const useMusicTrackSources = (
  api?: Pick<MusicSourceApi, 'listMusicTrackSources'>,
): ReadonlyMap<MusicTrackId, WireMusicTrackSource> => {
  const workbench = useWorkbench()
  const client = useMemo(() => api ?? createApiClient(), [api])
  const [sources, setSources] = useState<ReadonlyMap<MusicTrackId, WireMusicTrackSource>>(NONE)
  const { projectId, musicMadeEpoch } = workbench

  useEffect(() => {
    let alive = true
    client
      .listMusicTrackSources(projectId)
      .then((loaded) => {
        if (alive) setSources(loaded)
      })
      .catch(() => {
        // 頼み方が読めないと、プロンプトを見る口が出ないだけ。曲の一覧は別に読んで理由を出している。
        if (alive) setSources(NONE)
      })
    return () => {
      alive = false
    }
  }, [client, projectId, musicMadeEpoch])

  return sources
}
