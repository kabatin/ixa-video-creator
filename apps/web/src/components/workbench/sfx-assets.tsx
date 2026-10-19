'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Loaded } from '@/components/workbench/asset-store'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import type { SfxJobApi } from '@/lib/sfx-job-api'
import { sfxTreeItems, type SfxTreeItem } from '@/lib/sfx-tree'
import type { TimelineApi } from '@/lib/timeline-api'

/**
 * 効果音の素材（ADR-0052）。素材ツリー・素材ビューア・インスペクターが同じ一覧を見る。
 *
 * 一覧の正はサーバ（効果音の段のクリップと、作った効果音のジョブ）。サーバの材料を読み直したとき（`serverEpoch`。
 * インスペクターでクリップを直した・消した）と、効果音の素材が変わったとき（`sfxEpoch`。音を落とした・帯で動かした /
 * 切った / 消した・効果音ができた）に引き直す。`posterEpoch` は Take や絵のたびに進むので見ない（取り直しが多すぎる）。
 */

type SfxAssetsApi = Pick<TimelineApi, 'listClips'> & Pick<SfxJobApi, 'listSfxJobs'>

const SfxAssetsContext = createContext<Loaded<readonly SfxTreeItem[]> | null>(null)

/** 見守りの外（単体の部品のテストなど）では null。素材ツリーは効果音の段を出さない。 */
export const useSfxAssets = (): Loaded<readonly SfxTreeItem[]> | null => useContext(SfxAssetsContext)

export const SfxAssetsProvider = ({
  api,
  children,
}: {
  readonly api?: SfxAssetsApi
  readonly children: ReactNode
}) => {
  const { projectId, serverEpoch, sfxEpoch } = useWorkbench()
  const client = useMemo<SfxAssetsApi>(() => api ?? createApiClient(), [api])
  const [items, setItems] = useState<Loaded<readonly SfxTreeItem[]>>({ state: 'loading' })

  useEffect(() => {
    let cancelled = false
    Promise.all([client.listClips(projectId, 'SFX'), client.listSfxJobs(projectId)])
      .then(([clips, jobs]) => {
        if (!cancelled) setItems({ state: 'ready', value: sfxTreeItems(clips, jobs) })
      })
      .catch((cause: unknown) => {
        // 読めなかったことを黙らせない。空のままだと「効果音が無い」に化ける（L-015）。
        if (!cancelled) {
          setItems({ state: 'error', message: `効果音を読み込めませんでした: ${describeForPerson(cause)}` })
        }
      })
    return () => {
      cancelled = true
    }
  }, [client, projectId, serverEpoch, sfxEpoch])

  return <SfxAssetsContext.Provider value={items}>{children}</SfxAssetsContext.Provider>
}
