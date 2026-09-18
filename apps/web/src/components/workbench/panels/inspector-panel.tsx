'use client'

import { ShotInspector } from '@/components/workbench/shot-inspector'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { PanelEmpty, PanelFrame } from '@/components/workbench/panels/panel-frame'

/** インスペクター（右）。選択中の Shot を出す。 */
export const InspectorPanel = () => {
  const { shots, selectedShotId } = useWorkbench()
  const index = shots?.findIndex((shot) => shot.id === selectedShotId) ?? -1
  const shot = index < 0 ? null : (shots?.[index] ?? null)

  if (shot === null) {
    return (
      <PanelFrame>
        <PanelEmpty title="Shot を選んでください" hint="ストーリーボードか Shot 一覧で選ぶと、ここで直せます。" />
      </PanelFrame>
    )
  }
  return (
    <PanelFrame flush>
      <ShotInspector shot={shot} isFirst={index === 0} />
    </PanelFrame>
  )
}
