'use client'

import { EditHistoryPanel } from '@/components/edit-history-panel'
import { useWorkbench } from '@/components/workbench/workbench-context'

/** 変更履歴（ダイアログ）。一括で変えた操作を戻す（横断 ROADMAP）。 */
export const HistoryDialogBody = ({ onUndone }: { readonly onUndone: () => void }) => {
  const workbench = useWorkbench()
  return (
    <EditHistoryPanel
      projectId={workbench.projectId}
      shotCodes={new Map((workbench.shots ?? []).map((shot) => [shot.id, shot.code]))}
      onUndone={() => {
        workbench.refresh()
        onUndone()
      }}
    />
  )
}
