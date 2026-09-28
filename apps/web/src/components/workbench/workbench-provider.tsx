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
import { WorkbenchTransportProvider } from '@/components/workbench/workbench-transport-provider'
import { createApiClient, resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import type { WorkbenchDialog } from '@/lib/menu-model'
import type { WireMusicAnalysis } from '@/lib/music-api'
import { applyProjectEvent } from '@/lib/project-events'
import { EMPTY_SELECTION, pruneSelection, type ShotSelection } from '@/lib/shot-bulk'
import { posterByShotId, posterRetryDelayMs, type ShotPosterMap } from '@/lib/shot-posters'
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
  const [notice, setNotice] = useState<string | null>(null)
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

  /**
   * 消えた Shot を選んだまま・チェックしたままにしない。
   *
   * **インスペクターが見ている物も一緒に直す。** 以前はここが `selectedShotId` だけを
   * 先頭へ戻し、`inspected` を放置していた。結果、一覧は先頭行を強調し、
   * Take 比較は先頭 Shot の Take を並べ、右のインスペクターだけが
   * 「この Shot は見つかりません」と出す。3 つのパネルが 3 通りのことを言い、
   * どれが正しいか画面からは決められなかった。
   *
   * 素材（キャラクター・楽曲など）を見ているときは触らない。Shot の増減とは無関係。
   */
  useEffect(() => {
    if (shots === null) return
    const ids = shots.map((shot) => shot.id)
    const nextShotId = (current: ShotId | null): ShotId | null =>
      current !== null && ids.includes(current) ? current : (ids[0] ?? null)

    setCheckedState((current) => pruneSelection(current, ids))
    setSelectedShotId(nextShotId)
    setInspected((current) => {
      if (current === null || current.kind !== 'shot') return current
      if (ids.includes(current.id)) return current
      const fallback = ids[0] ?? null
      return fallback === null ? null : { kind: 'shot', id: fallback }
    })
  }, [shots])

  const live = useProjectEvents({
    projectId,
    baseUrl: resolveApiBaseUrl(),
    onEvent: (event) => {
      setShots((current) => (current === null ? current : applyProjectEvent(current, event).shots))
      // 採用が変わると表紙の絵も変わる。**別の経路の採用**（一括・別の画面・API）もここで拾う。
      // 以前は生成の成功でしか取り直さず、採用した Shot の絵が読み直すまで出なかった。
      if (event.type === 'shot.status') setPosterEpoch((epoch) => epoch + 1)
      if (
        event.type === 'generation_job.status' &&
        event.status === 'succeeded' &&
        event.takeId !== null
      ) {
        setNewTakeCount((count) => count + 1)
        // 採用 Take が変わればサムネイルも変わる。まとめて 1 往復で引き直す。
        setPosterEpoch((epoch) => epoch + 1)
      }
      // **失敗を画面まで運ぶ。** worker が作った理由をここで捨てると、
      // 利用者から見て「遅い」と「死んだ」が区別できなくなる。
      if (event.type === 'generation_job.status' && event.status === 'failed') {
        setNotice(`生成に失敗しました: ${event.error ?? '理由が届きませんでした。'}`)
      }
    },
  })

  /** 続けて取り直した回数。作っている行が無くなったら 0 に戻す。 */
  const posterAttempt = useRef(0)
  useEffect(() => {
    let cancelled = false
    let retry: ReturnType<typeof setTimeout> | null = null
    api
      .listShotPosters(projectId)
      .then((list) => {
        if (cancelled) return
        setPosters(posterByShotId(list))
        setPosterError(null)
        // サムネイルを作っている行があれば、少し待って取り直す（できたら自動で出る）。
        const delay = posterRetryDelayMs(list, posterAttempt.current)
        posterAttempt.current = delay === null ? 0 : posterAttempt.current + 1
        if (delay !== null) {
          retry = setTimeout(() => {
            setPosterEpoch((epoch) => epoch + 1)
          }, delay)
        }
      })
      .catch((error: unknown) => {
        // 取れなかったことを黙らせない。空の Map のままだと「絵が無い」に化ける（L-015）。
        if (!cancelled) setPosterError(`サムネイルを取得できませんでした: ${describeError(error)}`)
      })
    return () => {
      cancelled = true
      if (retry !== null) clearTimeout(retry)
    }
  }, [api, projectId, posterEpoch])

  /**
   * Shot が増えたらサムネイルを引き直す。
   *
   * 引けていない Shot は「サムネイルを読み込み中」と出る（「まだ無い」と混ぜないため。L-021）。
   * ところが引き直す合図は**生成が成功したとき**と `refresh()` しか無かったので、
   * 区切りから Shot を作った直後の 8 件は**そのまま「読み込み中」で止まり続けた**（実測）。
   * 待てば出ると読める文が、いつまでも出ないのは嘘になる。
   *
   * 同じ組み合わせでは二度頼まない（頼んでも埋まらない Shot があると回り続ける）。
   */
  const askedForRef = useRef<string | null>(null)
  useEffect(() => {
    if (shots === null) return
    const missing = shots.filter((shot) => !posters.has(shot.id)).map((shot) => shot.id)
    if (missing.length === 0) return
    const key = missing.join(',')
    if (askedForRef.current === key) return
    askedForRef.current = key
    setPosterEpoch((epoch) => epoch + 1)
  }, [shots, posters])

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
      notice,
      notify: setNotice,
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
      notice,
    ],
  )

  return (
    <WorkbenchContext.Provider value={value}>
      <WorkbenchTransportProvider transport={transport}>{props.children}</WorkbenchTransportProvider>
    </WorkbenchContext.Provider>
  )
}
