'use client'

import { WorkflowBar } from '@/components/workbench/workflow-bar'
import type { Location, MusicTrack, Project, Sequence, Shot } from '@ixa/domain'
import type { DockviewApi } from 'dockview-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { StatusBar } from '@/components/workbench/status-bar'
import { useRenderWatch } from '@/components/workbench/use-render-watch'
import { AiSetupOffer } from '@/components/workbench/ai-setup-offer'
import { WorkbenchDialogs } from '@/components/workbench/workbench-dialogs'
import { WorkbenchDock } from '@/components/workbench/workbench-dock'
import { WorkbenchMenu } from '@/components/workbench/workbench-menu'
import { WorkbenchProvider } from '@/components/workbench/workbench-provider'
import { WorkbenchStack, stackSectionId } from '@/components/workbench/workbench-stack'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { useEditHistory } from '@/components/workbench/use-edit-history'
import { useQueryNavigation } from '@/components/workbench/use-query-navigation'
import { useWorkbenchKeys } from '@/components/workbench/use-workbench-keys'
import type { WireMusicAnalysis } from '@/lib/music-api'
import {
  addDefaultPanels,
  clearWorkbenchLayout,
  focusPanel as focusDockPanel,
  sizeDefaultAreas,
  type PanelId,
} from '@/lib/workbench-layout'
import type { Inspected } from '@/lib/workbench-selection'
import { AssetStoreProvider } from '@/components/workbench/asset-store'
import { FileIntake } from '@/components/workbench/file-intake'
import type { WorkbenchQuery } from '@/lib/workbench-url'
import { ContextMenuHost } from '@/components/workbench/ui/context-menu'

export type ProjectWorkbenchProps = {
  readonly project: Project
  readonly initialShots: readonly Shot[] | null
  readonly track: MusicTrack | null
  readonly analysis: WireMusicAnalysis | null
  readonly musicLoaded: boolean
  readonly sequences: readonly Sequence[]
  readonly locations: readonly Location[] | null
  readonly loadErrors: readonly string[]
  readonly query: WorkbenchQuery
}

/** これより狭い画面はドックを使わず縦一列（UI-WORKBENCH 7.4）。 */
const WIDE_QUERY = '(min-width: 1024px)'

/** 画面幅。**最初の描画は広い側で固定**し、描画のあとに測る（サーバと食い違わせない。L-019）。 */
const useWideViewport = (): boolean => {
  const [wide, setWide] = useState(true)
  useEffect(() => {
    const query = window.matchMedia(WIDE_QUERY)
    const sync = (): void => {
      setWide(query.matches)
    }
    sync()
    query.addEventListener('change', sync)
    return () => {
      query.removeEventListener('change', sync)
    }
  }, [])
  return wide
}

/**
 * Project ワークベンチ（UI-WORKBENCH / ADR-0021）。1 画面で Project の全部を触る。
 *
 * ```
 * メニューバー
 * 素材 | 中央上（ストーリーボード / プレビュー / Take 比較）| 右（Shot 一覧 / インスペクター）
 *      | 中央下（聴きながら切る / タイムライン）            |
 * ステータスバー
 * ```
 */
export const ProjectWorkbench = (props: ProjectWorkbenchProps) => {
  const dock = useRef<DockviewApi | null>(null)
  const wide = useWideViewport()

  const focusPanel = useCallback(
    (panel: PanelId): void => {
      if (wide && dock.current !== null) {
        focusDockPanel(dock.current, panel)
        return
      }
      document.getElementById(stackSectionId(panel))?.scrollIntoView({ block: 'start' })
    },
    [wide],
  )

  /**
   * 楽曲ダイアログは無くした（UI-WORKBENCH-2 §4.4）。旧 `?dialog=music` はマスターの楽曲を
   * インスペクターで開く意味に読み替える（引き継ぎ文書・ブックマークを壊さない）。
   */
  const legacyMusic = props.query.dialog === 'music'
  const initialInspected: Inspected | null =
    legacyMusic && props.track !== null ? { kind: 'track', id: props.track.id } : null
  const initialDialog = props.query.dialog === 'music' ? null : props.query.dialog

  return (
    <AssetStoreProvider workspaceId={props.project.workspaceId} projectId={props.project.id}>
      <WorkbenchProvider
        project={props.project}
        initialShots={props.initialShots}
        track={props.track}
        analysis={props.analysis}
        musicLoaded={props.musicLoaded}
        sequences={props.sequences}
        locations={props.locations}
        loadErrors={props.loadErrors}
        initialShotId={props.query.shot}
        initialDialog={initialDialog}
        initialInspected={initialInspected}
        focusPanel={focusPanel}
      >
        {/* 右クリック（長押し・Shift+F10）のメニューの置き場。開いているのは 1 つだけ。 */}
        <ContextMenuHost>
          <WorkbenchShell dock={dock} wide={wide} query={props.query} />
        </ContextMenuHost>
      </WorkbenchProvider>
    </AssetStoreProvider>
  )
}

const WorkbenchShell = ({
  dock,
  wide,
  query,
}: {
  readonly dock: React.RefObject<DockviewApi | null>
  readonly wide: boolean
  readonly query: WorkbenchQuery
}) => {
  const workbench = useWorkbench()
  const notice = workbench.notice
  const setNotice = workbench.notify
  /** ドックの配置・前のタブが変わるたびに進む。メニューの作業モードの表示を追わせる。 */
  const [dockEpoch, setDockEpoch] = useState(0)
  const history = useEditHistory(workbench.projectId, workbench.serverEpoch)
  /** 「ファイルを取り込む…」でファイル選択を開く口。`FileIntake` が登録する。 */
  const fileOpener = useRef<(() => void) | null>(null)

  const resetLayout = (): void => {
    clearWorkbenchLayout(window.localStorage, workbench.projectId)
    const api = dock.current
    if (api !== null) {
      api.clear()
      addDefaultPanels(api)
      sizeDefaultAreas(api)
    }
    setNotice('パネルを初期配置に戻しました。')
  }

  const undo = (): void => {
    void history.undoLatest().then((message) => {
      setNotice(message)
      workbench.refresh()
    })
  }

  /**
   * 走っている書き出しの見守り。**ダイアログより上で作る。**
   * 中で作っていたころは、閉じた瞬間に部品ごと unmount されて追跡が止まり、
   * 「いま書き出している」がどこにも残らなかった（上限は 30 分に設定してある）。
   */
  const renderWatch = useRenderWatch({ projectId: workbench.projectId })

  useQueryNavigation(query)

  // 「聴きながら切る」へ譲るかはフックがフォーカスから決める。可視は渡さない。
  useWorkbenchKeys({ undo })

  return (
    <div className="flex h-full flex-col bg-bg">
      <WorkbenchMenu
        canUndo={history.canUndo}
        onUndo={undo}
        onResetLayout={resetLayout}
        onNotice={setNotice}
        dock={dock}
        dockEpoch={dockEpoch}
        onImportFiles={() => {
          fileOpener.current?.()
        }}
      />
      {/* 制作の流れ（制作者 2026-10-01）。次にやる所を目立たせ、押すとその作業の画面へ。 */}
      <WorkflowBar />
      {notice !== null && (
        <p
          role="status"
          className="flex shrink-0 items-center gap-2 border-b border-warn/40 bg-warn/10 px-2 py-1 text-sm text-warn"
        >
          <span className="min-w-0 flex-1 truncate">{notice}</span>
          <button
            type="button"
            onClick={() => {
              setNotice(null)
            }}
            className="h-6 rounded px-2 text-xs hover:bg-warn/20"
          >
            閉じる
          </button>
        </p>
      )}
      <main className="min-h-0 flex-1" aria-label={`${workbench.project.name} のワークベンチ`}>
        {wide ? (
          <WorkbenchDock
            projectId={workbench.projectId}
            query={query}
            onReady={(api) => {
              dock.current = api
              const bump = (): void => {
                setDockEpoch((epoch) => epoch + 1)
              }
              api.onDidActivePanelChange(bump)
              api.onDidLayoutChange(bump)
              bump()
            }}
            onNotice={setNotice}
          />
        ) : (
          <WorkbenchStack />
        )}
      </main>
      <StatusBar
        project={workbench.project}
        shotCount={workbench.shots?.length ?? null}
        live={workbench.live}
        loadErrors={workbench.loadErrors}
        renderWatch={renderWatch}
      />
      <WorkbenchDialogs onHistoryChanged={history.reload} renderWatch={renderWatch} />
      {/* 初めて開いたときに「使う AI」を 1 度だけ勧める（ADR-0032）。 */}
      <AiSetupOffer />
      <FileIntake
        onNotice={setNotice}
        registerOpener={(open) => {
          fileOpener.current = open
        }}
      />
    </div>
  )
}
