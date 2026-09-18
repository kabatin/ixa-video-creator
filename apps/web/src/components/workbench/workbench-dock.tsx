'use client'

import type { ProjectId } from '@ixa/domain'
import {
  DockviewReact,
  themeAbyss,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from 'dockview-react'
import { useEffect, useState } from 'react'
import type { FunctionComponent } from 'react'
import { AssetContentPanel } from '@/components/workbench/panels/asset-content-panel'
import { AssetsPanel } from '@/components/workbench/panels/assets-panel'
import { AutomaticPanel } from '@/components/workbench/panels/automatic-panel'
import { ComparePanel } from '@/components/workbench/panels/compare-panel'
import { CutterPanel } from '@/components/workbench/panels/cutter-panel'
import { DraftPanel } from '@/components/workbench/panels/draft-panel'
import { InspectorPanel } from '@/components/workbench/panels/inspector-panel'
import { PreviewPanel } from '@/components/workbench/panels/preview-panel'
import { ShotListPanel } from '@/components/workbench/panels/shot-list-panel'
import { StoryboardPanel } from '@/components/workbench/panels/storyboard-panel'
import { TimelinePanel } from '@/components/workbench/panels/timeline-panel'
import type { AssetRef } from '@/components/workbench/workbench-context'
import {
  ASSET_COMPONENT,
  addDefaultPanels,
  focusPanel,
  readStoredWorkbenchLayout,
  sizeDefaultAreas,
  writeWorkbenchLayout,
  type PanelId,
} from '@/lib/workbench-layout'
import type { WorkbenchQuery } from '@/lib/workbench-url'

/** 見えているかをドックに聞く。裏のタブは打鍵を受けない。 */
const useVisible = (api: IDockviewPanelProps['api']): boolean => {
  const [visible, setVisible] = useState(api.isVisible)
  useEffect(() => {
    const subscription = api.onDidVisibilityChange((event) => {
      setVisible(event.isVisible)
    })
    return () => {
      subscription.dispose()
    }
  }, [api])
  return visible
}

const CutterDock: FunctionComponent<IDockviewPanelProps> = ({ api }) => {
  const visible = useVisible(api)
  return <CutterPanel visible={visible} />
}

const AssetDock: FunctionComponent<IDockviewPanelProps<{ asset: AssetRef }>> = ({ params }) => (
  <AssetContentPanel asset={params.asset} />
)

/** Dockview に渡す部品。id は `workbench-layout.ts` の `PANEL_IDS` と同じ。 */
const COMPONENTS: Readonly<Record<PanelId | typeof ASSET_COMPONENT, FunctionComponent<IDockviewPanelProps>>> =
  Object.freeze({
    storyboard: () => <StoryboardPanel />,
    preview: () => <PreviewPanel />,
    compare: () => <ComparePanel />,
    draft: () => <DraftPanel />,
    cutter: CutterDock,
    timeline: () => <TimelinePanel />,
    automatic: () => <AutomaticPanel />,
    shots: () => <ShotListPanel />,
    inspector: () => <InspectorPanel />,
    assets: () => <AssetsPanel />,
    [ASSET_COMPONENT]: AssetDock as FunctionComponent<IDockviewPanelProps>,
  })

export type WorkbenchDockProps = {
  readonly projectId: ProjectId
  /** URL で指定されたタブ。開いたときに一度だけ前に出す（§7.1）。 */
  readonly query: WorkbenchQuery
  readonly onReady: (api: DockviewApi) => void
  /** 配置を戻した理由など。利用者に必ず知らせる。 */
  readonly onNotice: (message: string) => void
}

/**
 * ワークベンチのドック（UI-WORKBENCH §3 / ADR-0021 D1）。
 *
 * 保存した配置があれば戻し、無い・壊れていれば既定配置で開く。**壊れていたらその旨を出す。**
 * 黙って既定に戻すと、利用者は自分の配置がなぜ消えたのか分からない。
 */
export const WorkbenchDock = ({ projectId, query, onReady, onNotice }: WorkbenchDockProps) => {
  const ready = (event: DockviewReadyEvent): void => {
    const api = event.api
    const stored = readStoredWorkbenchLayout(window.localStorage, projectId)
    if (stored.state === 'ready') {
      try {
        api.fromJSON(stored.layout)
      } catch (error) {
        api.clear()
        addDefaultPanels(api)
        sizeDefaultAreas(api)
        onNotice(
          `保存した配置を復元できないため初期配置で開きました: ${
            error instanceof Error ? error.message : '不明なエラー'
          }`,
        )
      }
    } else {
      addDefaultPanels(api)
      sizeDefaultAreas(api)
      if (stored.state === 'invalid') {
        onNotice(`保存した配置が壊れているため初期配置で開きました: ${stored.reason}`)
      }
    }

    // URL で指定されたタブを前に出す。指定の無い区画は保存した配置のまま。
    ;[query.main, query.bottom, query.side].forEach((panel) => {
      if (panel !== null) focusPanel(api, panel)
    })

    api.onDidLayoutChange(() => {
      writeWorkbenchLayout(window.localStorage, projectId, api.toJSON())
    })
    onReady(api)
  }

  return (
    <div className="workbench-dock h-full">
      <DockviewReact components={COMPONENTS} theme={themeAbyss} onReady={ready} />
    </div>
  )
}
