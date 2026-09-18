'use client'

import { StoryboardPanel as AutomaticSplit } from '@/components/storyboard-panel'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { MusicGate } from '@/components/workbench/panels/music-gate'
import { PanelFrame } from '@/components/workbench/panels/panel-frame'

/** 自動で割る（中央下の裏のタブ）。解析セクションから粗く割る補助。主は「聴きながら切る」。 */
export const AutomaticPanel = () => {
  const workbench = useWorkbench()
  return (
    <PanelFrame>
      <MusicGate>
        {({ track, analysis }) => (
          <>
            <p className="mb-2 text-sm text-muted">
              解析セクションから粗く割る補助機能です。主の操作は「聴きながら切る」です。
            </p>
            <AutomaticSplit
              projectId={workbench.projectId}
              track={track}
              analysis={analysis}
              sequences={workbench.sequences}
            />
          </>
        )}
      </MusicGate>
    </PanelFrame>
  )
}
