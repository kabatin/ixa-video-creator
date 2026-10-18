'use client'

import { useContext } from 'react'
import { EditHistoryPanel } from '@/components/edit-history-panel'
import { AssetStoreContext } from '@/components/workbench/asset-store'
import { useWorkbench } from '@/components/workbench/workbench-context'

/** 変更履歴（ダイアログ）。一括で変えた操作を戻す（横断 ROADMAP）。 */
export const HistoryDialogBody = ({ onUndone }: { readonly onUndone: () => void }) => {
  const workbench = useWorkbench()
  // 曲を切る・素材を消すなどの記録を戻すと楽曲・素材の一覧が変わる。それも読み直す。
  const assets = useContext(AssetStoreContext)
  return (
    <EditHistoryPanel
      projectId={workbench.projectId}
      shotCodes={new Map((workbench.shots ?? []).map((shot) => [shot.id, shot.code]))}
      onUndone={() => {
        workbench.refresh()
        void assets?.actions.reloadAll()
        onUndone()
      }}
    />
  )
}
