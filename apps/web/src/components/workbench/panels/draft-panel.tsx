'use client'

import { StoryboardDraftPanel } from '@/components/storyboard-draft-panel'
import { Button } from '@/components/ui/button'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { PanelEmpty, PanelFrame } from '@/components/workbench/panels/panel-frame'
import { WORKFLOW_ACTIONS } from '@/lib/workflow-steps'

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
  // 案を作る相手がいない。次にやることを言う（制作者 2026-10-04）。
  if (workbench.shots.length === 0) {
    return (
      <PanelFrame>
        <PanelEmpty
          title="Shot はまだありません"
          hint="区切って Shot にすると、ここで AI に全 Shot の絵コンテの案をまとめて作らせられます。"
        >
          <Button
            tone="primary"
            size="sm"
            onClick={() => {
              workbench.openCutter('cut')
            }}
          >
            {WORKFLOW_ACTIONS.shots}
          </Button>
        </PanelEmpty>
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
        // CUT を押したら、その Shot のインスペクターの「絵コンテ」を開く（手で直す入口。制作者 2026-10-03「絵コンテ自分で
        // 入力、編集することできない？」）。
        onSelectShot={(shotId) => {
          workbench.selectShot(shotId)
          workbench.openInspector('settings')
        }}
      />
    </PanelFrame>
  )
}
