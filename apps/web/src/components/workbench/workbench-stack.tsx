'use client'

import type { ReactNode } from 'react'
import { AssetsPanel } from '@/components/workbench/panels/assets-panel'
import { ComparePanel } from '@/components/workbench/panels/compare-panel'
import { CutterPanel } from '@/components/workbench/panels/cutter-panel'
import { InspectorPanel } from '@/components/workbench/panels/inspector-panel'
import { PreviewPanel } from '@/components/workbench/panels/preview-panel'
import { ShotListPanel } from '@/components/workbench/panels/shot-list-panel'
import { StoryboardPanel } from '@/components/workbench/panels/storyboard-panel'
import { TimelinePanel } from '@/components/workbench/panels/timeline-panel'
import { ViewerPanel } from '@/components/workbench/panels/viewer-panel'
import { PANEL_SPECS, type PanelId } from '@/lib/workbench-layout'

/** 狭い画面で縦に並べる順。判断に要る順（絵 → 選ぶ → 直す → 比べる → 切る）。 */
const STACK: readonly {
  readonly id: PanelId
  readonly body: ReactNode
  readonly tall?: boolean
}[] = [
  { id: 'storyboard', body: <StoryboardPanel /> },
  { id: 'shots', body: <ShotListPanel /> },
  { id: 'inspector', body: <InspectorPanel />, tall: true },
  { id: 'compare', body: <ComparePanel />, tall: true },
  { id: 'preview', body: <PreviewPanel /> },
  { id: 'cutter', body: <CutterPanel visible />, tall: true },
  { id: 'timeline', body: <TimelinePanel />, tall: true },
  { id: 'assets', body: <AssetsPanel /> },
  { id: 'viewer', body: <ViewerPanel /> },
]

export const stackSectionId = (id: PanelId): string => `workbench-section-${id}`

/**
 * 1024px 未満の縦一列（UI-WORKBENCH 7.4）。**ドックを使わない。**
 * 狭い区画にドックの分割を押し込むと、どのパネルも読めない幅になる（ADR-0020 と同じ判断）。
 * 各パネルは自前でスクロールするので、区画ごとに高さを与える。
 */
export const WorkbenchStack = () => (
  <div className="h-full space-y-3 overflow-auto p-2">
    {STACK.map((entry) => (
      <section
        key={entry.id}
        id={stackSectionId(entry.id)}
        aria-label={PANEL_SPECS[entry.id].title}
        className={`flex flex-col overflow-hidden rounded-md border border-line ${entry.tall === true ? 'h-[85vh]' : 'h-[60vh]'}`}
      >
        <h2 className="shrink-0 border-b border-line bg-surface px-2 py-1 text-sm font-semibold text-text">
          {PANEL_SPECS[entry.id].title}
        </h2>
        <div className="min-h-0 flex-1">{entry.body}</div>
      </section>
    ))}
  </div>
)
