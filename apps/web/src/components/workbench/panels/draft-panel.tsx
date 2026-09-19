'use client'

import { StoryboardDraftPanel } from '@/components/storyboard-draft-panel'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { PanelEmpty, PanelFrame } from '@/components/workbench/panels/panel-frame'

/**
 * 絵コンテ下書き（中央上の裏のタブ）。**下書きは Shot を書き換えない。**
 * 採用した Shot だけが変わるので、Provider の一覧も差し替えてインスペクターと食い違わせない。
 */
export const DraftPanel = () => {
  const workbench = useWorkbench()
  if (workbench.shots === null) {
    return (
      <PanelFrame>
        <PanelEmpty title="Shot を読み込めていません" />
      </PanelFrame>
    )
  }
  return (
    <PanelFrame>
      <StoryboardDraftPanel
        projectId={workbench.projectId}
        shots={workbench.shots.map((shot) => ({
          id: shot.id,
          code: shot.code,
          description: shot.description,
          mood: shot.mood,
        }))}
        onAdopted={workbench.applyAdoptedShots}
        onSelectShot={workbench.selectShot}
      />
    </PanelFrame>
  )
}
