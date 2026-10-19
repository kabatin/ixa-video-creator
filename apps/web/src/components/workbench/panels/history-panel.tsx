'use client'

import { HistoryDialogBody } from '@/components/workbench/dialogs/history-dialog'
import { PanelFrame } from '@/components/workbench/panels/panel-frame'
import { useWorkbench } from '@/components/workbench/workbench-context'

/**
 * 変更履歴（下の区画）。中身は ⌘Y のダイアログと同じ部品（ダイアログも残す）。
 *
 * **サーバから読み直すたびに作り直す。** ⌘Z やダイアログで戻したあと、
 * このタブだけ古い一覧のまま「戻す」を押せる状態にしない。
 */
export const HistoryPanel = () => {
  const { serverEpoch } = useWorkbench()
  return (
    <PanelFrame>
      <HistoryDialogBody key={serverEpoch} onUndone={() => undefined} />
    </PanelFrame>
  )
}
