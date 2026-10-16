'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useAssets, type Loaded } from '@/components/workbench/asset-store'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import type { MusicGenerateBody, MusicJobApi, WireMusicJob } from '@/lib/music-job-api'

/**
 * 曲を作るジョブ（ADR-0048）の見守り。**ダイアログより上に置く。**
 * 中に置くと、閉じた瞬間に追跡が止まり「いま作っている」がどこにも残らない（書き出しの見守りと同じ）。
 *
 * 一覧の正はサーバ。出来事（`musicJobEpoch`）が届くたび・頼んだ・止めたあとに引き直す。
 * 曲ができたら（`musicMadeEpoch`）楽曲の一覧を読み直す。
 */

export type MusicJobsValue = {
  readonly jobs: Loaded<readonly WireMusicJob[]>
  /** 作り始める。受け付けられなければ例外（理由は呼び出し側が見せる）。 */
  readonly submit: (body: MusicGenerateBody) => Promise<void>
  /** 待っている・作っているジョブをまとめて止める。 */
  readonly cancel: () => Promise<void>
}

const MusicJobsContext = createContext<MusicJobsValue | null>(null)

/** 見守りの外（単体の部品のテストなど）では null。進み具合は出さない。 */
export const useMusicJobs = (): MusicJobsValue | null => useContext(MusicJobsContext)

export const MusicJobsProvider = ({
  api,
  children,
}: {
  readonly api?: MusicJobApi
  readonly children: ReactNode
}) => {
  const workbench = useWorkbench()
  const { actions } = useAssets()
  const client = useMemo<MusicJobApi>(() => api ?? createApiClient(), [api])
  const { projectId, musicJobEpoch, musicMadeEpoch, notify } = workbench
  const [jobs, setJobs] = useState<Loaded<readonly WireMusicJob[]>>({ state: 'loading' })
  const [localEpoch, setLocalEpoch] = useState(0)

  useEffect(() => {
    let cancelled = false
    client
      .listMusicJobs(projectId)
      .then((list) => {
        if (!cancelled) setJobs({ state: 'ready', value: list })
      })
      .catch((cause: unknown) => {
        // 取れなかったことを黙らせない。空のままだと「作っていない」に化ける（L-015）。
        if (!cancelled) {
          setJobs({ state: 'error', message: `曲を作る進み具合を読み込めませんでした: ${describeForPerson(cause)}` })
        }
      })
    return () => {
      cancelled = true
    }
  }, [client, projectId, musicJobEpoch, localEpoch])

  // 描画ごとに作り直される関数は、最新を控えて呼ぶ（曲ができたときだけ走らせる）。
  const reloadTracks = useRef(actions.reloadTracks)
  reloadTracks.current = actions.reloadTracks
  const notifyRef = useRef(notify)
  notifyRef.current = notify
  useEffect(() => {
    // 最初の描画（0）では読み直さない。楽曲の一覧はストアが自分で読む。
    if (musicMadeEpoch === 0) return
    reloadTracks.current().catch((cause: unknown) => {
      notifyRef.current(`曲はできましたが、楽曲の一覧を読み直せませんでした: ${describeForPerson(cause)}`)
    })
  }, [musicMadeEpoch])

  const submit = useCallback(
    async (body: MusicGenerateBody): Promise<void> => {
      await client.generateMusic(projectId, body)
      setLocalEpoch((epoch) => epoch + 1)
    },
    [client, projectId],
  )

  const cancel = useCallback(async (): Promise<void> => {
    await client.cancelMusicJobs(projectId)
    setLocalEpoch((epoch) => epoch + 1)
  }, [client, projectId])

  const value = useMemo<MusicJobsValue>(() => ({ jobs, submit, cancel }), [jobs, submit, cancel])
  return <MusicJobsContext.Provider value={value}>{children}</MusicJobsContext.Provider>
}
