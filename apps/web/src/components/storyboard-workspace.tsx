'use client'

import type { MusicTrack, ProjectId, Sequence, Shot, ShotId } from '@ixa/domain'
import {
  DockviewReact,
  themeAbyss,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from 'dockview-react'
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { FunctionComponent } from 'react'
import { CutEditor } from '@/components/cut-editor'
import { StoryboardInspector } from '@/components/storyboard-inspector'
import { StoryboardPanel } from '@/components/storyboard-panel'
import { StoryboardPosterStrip } from '@/components/storyboard-poster-strip'
import { Button } from '@/components/ui/button'
import { createApiClient } from '@/lib/api-client'
import type { WireMusicAnalysis } from '@/lib/music-api'
import {
  clearStoryboardLayout,
  readStoredStoryboardLayout,
  writeStoryboardLayout,
} from '@/lib/storyboard-layout'
import { posterByShotId, type ShotPosterMap } from '@/lib/shot-posters'

export type StoryboardWorkspaceProps = {
  readonly projectId: ProjectId
  readonly track: MusicTrack
  readonly analysis: WireMusicAnalysis
  readonly sequences: readonly Sequence[]
  readonly initialShots: readonly Shot[]
}

type WorkspaceContextValue = StoryboardWorkspaceProps & {
  readonly shots: readonly Shot[]
  readonly posters: ShotPosterMap
  readonly selectedShotId: ShotId | null
  readonly posterError: string | null
  readonly selectShot: (shotId: ShotId) => void
  readonly saveShot: (
    shot: Shot,
    patch: Pick<Shot, 'description' | 'continuityMode'>,
  ) => Promise<void>
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

const useWorkspace = (): WorkspaceContextValue => {
  const value = useContext(WorkspaceContext)
  if (value === null) throw new Error('Storyboard panel is outside StoryboardWorkspace')
  return value
}

const PostersContent = () => {
  const workspace = useWorkspace()
  return (
    <div className="h-full">
      {workspace.posterError !== null && (
        <p role="alert" className="border-b border-line bg-danger/10 px-3 py-2 text-xs text-danger">
          {workspace.posterError}
        </p>
      )}
      <StoryboardPosterStrip
        shots={workspace.shots}
        posters={workspace.posters}
        selectedShotId={workspace.selectedShotId}
        onSelect={workspace.selectShot}
      />
    </div>
  )
}
const PostersPanel: FunctionComponent<IDockviewPanelProps> = () => <PostersContent />

const InspectorContent = () => {
  const workspace = useWorkspace()
  const index = workspace.shots.findIndex((shot) => shot.id === workspace.selectedShotId)
  return (
    <StoryboardInspector
      shot={index < 0 ? null : (workspace.shots[index] ?? null)}
      isFirst={index === 0}
      onSave={workspace.saveShot}
    />
  )
}
const InspectorPanel: FunctionComponent<IDockviewPanelProps> = () => <InspectorContent />

const CutterContent = () => {
  const workspace = useWorkspace()
  return (
    <div className="h-full overflow-auto bg-bg p-3">
      <CutEditor
        projectId={workspace.projectId}
        track={workspace.track}
        analysis={workspace.analysis}
        sequences={workspace.sequences}
      />
    </div>
  )
}
const CutterPanel: FunctionComponent<IDockviewPanelProps> = () => <CutterContent />

const AutomaticContent = () => {
  const workspace = useWorkspace()
  return (
    <div className="h-full overflow-auto bg-bg p-3">
      <p className="mb-3 text-sm text-muted">
        解析セクションから粗く割る補助機能です。主の操作は「聴きながら切る」です。
      </p>
      <StoryboardPanel
        projectId={workspace.projectId}
        track={workspace.track}
        analysis={workspace.analysis}
        sequences={workspace.sequences}
      />
    </div>
  )
}
const AutomaticPanel: FunctionComponent<IDockviewPanelProps> = () => <AutomaticContent />

const COMPONENTS = Object.freeze({
  posters: PostersPanel,
  inspector: InspectorPanel,
  cutter: CutterPanel,
  automatic: AutomaticPanel,
})

const addDefaultPanels = (api: DockviewApi): void => {
  api.addPanel({ id: 'posters', component: 'posters', title: 'ポスター' })
  api.addPanel({
    id: 'inspector',
    component: 'inspector',
    title: 'Shot 設定',
    initialWidth: 360,
    position: { referencePanel: 'posters', direction: 'right' },
  })
  api.addPanel({
    id: 'cutter',
    component: 'cutter',
    title: '聴きながら切る',
    initialHeight: 500,
    position: { referencePanel: 'posters', direction: 'below' },
  })
  api.addPanel({
    id: 'automatic',
    component: 'automatic',
    title: '自動で割る',
    inactive: true,
    position: { referencePanel: 'cutter', direction: 'within' },
  })
}

const replaceShot = (shots: readonly Shot[], next: Shot): readonly Shot[] =>
  shots.map((shot) => (shot.id === next.id ? next : shot))

export const StoryboardWorkspace = (props: StoryboardWorkspaceProps) => {
  const apiClient = useMemo(() => createApiClient(), [])
  const dockApi = useRef<DockviewApi | null>(null)
  const [shots, setShots] = useState<readonly Shot[]>(props.initialShots)
  const [posters, setPosters] = useState<ShotPosterMap>(new Map())
  const [posterError, setPosterError] = useState<string | null>(null)
  const [layoutNotice, setLayoutNotice] = useState<string | null>(null)
  const [wideViewport, setWideViewport] = useState(false)
  const [selectedShotId, setSelectedShotId] = useState<ShotId | null>(
    props.initialShots[0]?.id ?? null,
  )

  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)')
    const sync = (): void => {
      setWideViewport(query.matches)
    }
    sync()
    query.addEventListener('change', sync)
    return () => {
      query.removeEventListener('change', sync)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    apiClient
      .listShotPosters(props.projectId)
      .then((list) => {
        if (!cancelled) setPosters(posterByShotId(list))
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setPosterError(
            error instanceof Error ? error.message : 'サムネイルを取得できませんでした',
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [apiClient, props.projectId])

  const saveShot = async (
    shot: Shot,
    patch: Pick<Shot, 'description' | 'continuityMode'>,
  ): Promise<void> => {
    const updated = await apiClient.updateShot(shot.id, patch)
    setShots((current) => replaceShot(current, updated))
  }

  const context = useMemo<WorkspaceContextValue>(
    () => ({
      ...props,
      shots,
      posters,
      selectedShotId,
      posterError,
      selectShot: setSelectedShotId,
      saveShot,
    }),
    [posterError, posters, props, selectedShotId, shots],
  )

  const onReady = (event: DockviewReadyEvent): void => {
    dockApi.current = event.api
    const stored = readStoredStoryboardLayout(window.localStorage, props.projectId)
    if (stored.state === 'ready') {
      try {
        event.api.fromJSON(stored.layout)
      } catch (error) {
        event.api.clear()
        addDefaultPanels(event.api)
        setLayoutNotice(
          `保存した配置を復元できないため初期配置で開きました: ${
            error instanceof Error ? error.message : '不明なエラー'
          }`,
        )
      }
    } else {
      addDefaultPanels(event.api)
      if (stored.state === 'invalid') {
        setLayoutNotice(`保存した配置が壊れているため初期配置で開きました: ${stored.reason}`)
      }
    }

    event.api.onDidLayoutChange(() => {
      writeStoryboardLayout(window.localStorage, props.projectId, event.api.toJSON())
    })
  }

  const resetLayout = (): void => {
    clearStoryboardLayout(window.localStorage, props.projectId)
    const api = dockApi.current
    if (api !== null) {
      api.clear()
      addDefaultPanels(api)
    }
    setLayoutNotice('パネルを初期配置に戻しました。')
  }

  return (
    <WorkspaceContext.Provider value={context}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          タブを掴んで移動し、境界をドラッグして広さを変えられます。
        </p>
        <Button size="sm" onClick={resetLayout}>
          パネル配置をリセット
        </Button>
      </div>
      {layoutNotice !== null && (
        <p
          role="status"
          className="mb-3 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn"
        >
          {layoutNotice}
        </p>
      )}

      {wideViewport ? (
        <div className="storyboard-dock h-[calc(100vh-13rem)] min-h-[680px] overflow-hidden rounded-lg border border-line">
          <DockviewReact components={COMPONENTS} theme={themeAbyss} onReady={onReady} />
        </div>
      ) : (
        <div className="space-y-4">
          <section className="min-h-72 overflow-auto rounded-lg border border-line">
            <PostersContent />
          </section>
          <section className="rounded-lg border border-line">
            <InspectorContent />
          </section>
          <section className="max-h-[70vh] overflow-auto rounded-lg border border-line">
            <CutterContent />
          </section>
          <details className="rounded-lg border border-line bg-surface p-3">
            <summary className="cursor-pointer font-semibold text-text">自動で割る</summary>
            <AutomaticContent />
          </details>
        </div>
      )}
    </WorkspaceContext.Provider>
  )
}
