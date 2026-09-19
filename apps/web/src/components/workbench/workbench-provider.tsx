'use client'

import type { Location, MusicTrack, Project, Sequence, Shot, ShotId } from '@ixa/domain'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  WorkbenchContext,
  type InspectorTab,
  type ShotPatch,
  type WorkbenchContextValue,
} from '@/components/workbench/workbench-context'
import { useWorkbenchTransport } from '@/components/workbench/use-workbench-transport'
import { createApiClient, resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import type { WorkbenchDialog } from '@/lib/menu-model'
import type { WireMusicAnalysis } from '@/lib/music-api'
import { applyProjectEvent } from '@/lib/project-events'
import { EMPTY_SELECTION, pruneSelection, type ShotSelection } from '@/lib/shot-bulk'
import { posterByShotId, type ShotPosterMap } from '@/lib/shot-posters'
import { useProjectEvents } from '@/lib/use-project-events'
import type { PanelId } from '@/lib/workbench-layout'
import type { Inspected } from '@/lib/workbench-selection'

export type WorkbenchProviderProps = {
  readonly project: Project
  /** null は「読めていない」。 */
  readonly initialShots: readonly Shot[] | null
  readonly track: MusicTrack | null
  readonly analysis: WireMusicAnalysis | null
  readonly musicLoaded: boolean
  readonly sequences: readonly Sequence[]
  readonly locations: readonly Location[] | null
  readonly loadErrors: readonly string[]
  /** URL の `?shot`。一覧に無ければ先頭 Shot を選ぶ。 */
  readonly initialShotId: ShotId | null
  readonly initialDialog: WorkbenchDialog | null
  /** 最初にインスペクターで見るもの（旧 `?dialog=music` → マスターの楽曲など）。 */
  readonly initialInspected: Inspected | null
  /** Dockview の操作。ドックの持ち主（`project-workbench`）が渡す。 */
  readonly focusPanel: (panel: PanelId) => void
  readonly children: ReactNode
}

/** 引く前の状態。空の Map は「1 件も無い」ではなく「まだ引いていない」（L-021）。 */
const NO_POSTERS: ShotPosterMap = new Map()

const replaceById = (shots: readonly Shot[], updated: readonly Shot[]): readonly Shot[] => {
  const byId = new Map(updated.map((shot) => [shot.id, shot] as const))
  return shots.map((shot) => byId.get(shot.id) ?? shot)
}

const initialSelection = (shots: readonly Shot[] | null, wanted: ShotId | null): ShotId | null => {
  if (shots === null) return null
  if (wanted !== null && shots.some((shot) => shot.id === wanted)) return wanted
  return shots[0]?.id ?? null
}

/**
 * ワークベンチの共有状態の持ち主（UI-WORKBENCH §7.2）。
 *
 * - **一覧の正はサーバ。** 既存の部品は保存のあと `router.refresh()` を呼ぶので、
 *   サーバから新しい一覧が届いたら手元を差し替える
 * - SSE の購読はここ 1 箇所。生成の状態を一覧へ映す
 * - サムネイルは 1 往復でまとめて引く。署名付き URL はこの state の中だけ（規約 7）
 */
export const WorkbenchProvider = (props: WorkbenchProviderProps) => {
  const router = useRouter()
  const api = useMemo(() => createApiClient(), [])
  const projectId = props.project.id

  const [shots, setShots] = useState<readonly Shot[] | null>(props.initialShots)
  const [selectedShotId, setSelectedShotId] = useState<ShotId | null>(() =>
    initialSelection(props.initialShots, props.initialShotId),
  )
  const [inspected, setInspected] = useState<Inspected | null>(() => {
    if (props.initialInspected !== null) return props.initialInspected
    const shotId = initialSelection(props.initialShots, props.initialShotId)
    return shotId === null ? null : { kind: 'shot', id: shotId }
  })
  const [checked, setCheckedState] = useState<ShotSelection>(EMPTY_SELECTION)
  const [posters, setPosters] = useState<ShotPosterMap>(NO_POSTERS)
  const [posterError, setPosterError] = useState<string | null>(null)
  const [posterEpoch, setPosterEpoch] = useState(0)
  const [newTakeCount, setNewTakeCount] = useState(0)
  const [dialog, setDialog] = useState<WorkbenchDialog | null>(props.initialDialog)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('settings')
  const { transport, controls } = useWorkbenchTransport()

  const [serverEpoch, setServerEpoch] = useState(0)
  const lastServerShots = useRef(props.initialShots)

  /**
   * サーバから新しい一覧が届いた（`router.refresh()` のあと）。手元を差し替える。
   * 最初の描画は初期値そのものなので数えない（取り直しを 2 回走らせない）。
   */
  useEffect(() => {
    if (lastServerShots.current === props.initialShots) return
    lastServerShots.current = props.initialShots
    setShots(props.initialShots)
    setServerEpoch((epoch) => epoch + 1)
  }, [props.initialShots])

  /** 消えた Shot を選んだまま・チェックしたままにしない。 */
  useEffect(() => {
    if (shots === null) return
    const ids = shots.map((shot) => shot.id)
    setCheckedState((current) => pruneSelection(current, ids))
    setSelectedShotId((current) =>
      current !== null && ids.includes(current) ? current : (ids[0] ?? null),
    )
  }, [shots])

  const live = useProjectEvents({
    projectId,
    baseUrl: resolveApiBaseUrl(),
    onEvent: (event) => {
      setShots((current) => (current === null ? current : applyProjectEvent(current, event).shots))
      if (
        event.type === 'generation_job.status' &&
        event.status === 'succeeded' &&
        event.takeId !== null
      ) {
        setNewTakeCount((count) => count + 1)
        // 採用 Take が変わればサムネイルも変わる。まとめて 1 往復で引き直す。
        setPosterEpoch((epoch) => epoch + 1)
      }
    },
  })

  useEffect(() => {
    let cancelled = false
    api
      .listShotPosters(projectId)
      .then((list) => {
        if (cancelled) return
        setPosters(posterByShotId(list))
        setPosterError(null)
      })
      .catch((error: unknown) => {
        // 取れなかったことを黙らせない。空の Map のままだと「絵が無い」に化ける（L-015）。
        if (!cancelled) setPosterError(`サムネイルを取得できませんでした: ${describeError(error)}`)
      })
    return () => {
      cancelled = true
    }
  }, [api, projectId, posterEpoch])

  const replaceShots = useCallback((updated: readonly Shot[]): void => {
    setShots((current) => (current === null ? current : replaceById(current, updated)))
  }, [])

  const saveShot = useCallback(
    async (shotId: ShotId, patch: ShotPatch): Promise<Shot> => {
      const updated = await api.updateShot(shotId, patch)
      replaceShots([updated])
      return updated
    },
    [api, replaceShots],
  )

  /** 採用は description / mood しか書き換えないので、残りの列は手元の値を残す。 */
  const applyAdoptedShots = useCallback(
    (adopted: readonly Pick<Shot, 'id' | 'description' | 'mood'>[]): void => {
      const patches = new Map(adopted.map((shot) => [shot.id, shot] as const))
      setShots((current) =>
        current === null
          ? current
          : current.map((shot) => {
              const patch = patches.get(shot.id)
              return patch === undefined
                ? shot
                : { ...shot, description: patch.description, mood: patch.mood }
            }),
      )
    },
    [],
  )

  const refresh = useCallback((): void => {
    router.refresh()
    setPosterEpoch((epoch) => epoch + 1)
  }, [router])

  const value = useMemo<WorkbenchContextValue>(
    () => ({
      project: props.project,
      projectId,
      track: props.track,
      analysis: props.analysis,
      musicLoaded: props.musicLoaded,
      sequences: props.sequences,
      locations: props.locations,
      loadErrors: props.loadErrors,
      shots,
      posters,
      posterError,
      posterEpoch,
      serverEpoch,
      selectedShotId,
      selectShot: (shotId) => {
        setSelectedShotId(shotId)
        setInspected({ kind: 'shot', id: shotId })
      },
      inspected,
      inspect: (selection) => {
        if (selection?.kind === 'shot') setSelectedShotId(selection.id)
        setInspected(selection)
      },
      checked,
      setChecked: setCheckedState,
      transport,
      transportControls: controls,
      live: { ...live, newTakeCount },
      saveShot,
      replaceShots,
      applyAdoptedShots,
      refresh,
      dialog,
      openDialog: (next) => {
        // ダイアログを開いている間はプレビューを止める。ぼかしの下で再生すると重い（§12）。
        controls.pause()
        setDialog(next)
      },
      closeDialog: () => {
        setDialog(null)
      },
      focusPanel: props.focusPanel,
      inspectorTab,
      openInspector: (tab) => {
        setInspectorTab(tab)
        props.focusPanel('inspector')
      },
      openViewer: () => {
        props.focusPanel('viewer')
      },
    }),
    [
      props,
      projectId,
      shots,
      posters,
      posterError,
      posterEpoch,
      serverEpoch,
      selectedShotId,
      checked,
      transport,
      controls,
      live,
      newTakeCount,
      saveShot,
      replaceShots,
      applyAdoptedShots,
      refresh,
      dialog,
      inspectorTab,
      inspected,
    ],
  )

  return <WorkbenchContext.Provider value={value}>{props.children}</WorkbenchContext.Provider>
}
