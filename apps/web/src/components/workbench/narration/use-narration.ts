'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Loaded } from '@/components/workbench/asset-store'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import type { WireNarrationOverview } from '@/lib/narration-api'

/**
 * ナレーションの一覧（ADR-0038）。声のジョブが動いたら（narrationEpoch）・サーバを読み直したら取り直す。
 * 直した口は新しい一覧を返すので `apply` で差し替え、ほかのパネル（タイムライン）には `bumpNarration` で知らせる。
 */
export const useNarration = () => {
  const { projectId, narrationEpoch, serverEpoch, bumpNarration } = useWorkbench()
  const api = useMemo(() => createApiClient(), [])
  const [overview, setOverview] = useState<Loaded<WireNarrationOverview>>({ state: 'loading' })

  useEffect(() => {
    let cancelled = false
    api
      .getNarration(projectId)
      .then((value) => {
        if (!cancelled) setOverview({ state: 'ready', value })
      })
      .catch((cause: unknown) => {
        if (!cancelled) setOverview({ state: 'error', message: `ナレーションを読み込めませんでした: ${describeForPerson(cause)}` })
      })
    return () => {
      cancelled = true
    }
  }, [api, projectId, narrationEpoch, serverEpoch])

  /** 直した結果（新しい一覧）を出し、タイムライン（声のレーン・テロップ）にも取り直させる。 */
  const apply = useCallback(
    (value: WireNarrationOverview): void => {
      setOverview({ state: 'ready', value })
      bumpNarration()
    },
    [bumpNarration],
  )

  return { api, overview, apply, bumpNarration }
}
