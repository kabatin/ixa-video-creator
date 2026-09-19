'use client'

import { HistoryDialogBody } from '@/components/workbench/dialogs/history-dialog'
import { NewShotDialogBody } from '@/components/workbench/dialogs/new-shot-dialog'
import { PreferencesDialogBody } from '@/components/workbench/dialogs/preferences-dialog'
import { RenderDialogBody } from '@/components/workbench/dialogs/render-dialog'
import { SettingsDialogBody } from '@/components/workbench/dialogs/settings-dialog'
import { ShortcutList } from '@/components/workbench/dialogs/shortcuts-dialog'
import { WorkbenchDialog } from '@/components/workbench/workbench-dialog'
import { useWorkbench } from '@/components/workbench/workbench-context'
import type { WorkbenchDialog as DialogKind } from '@/lib/menu-model'

const TITLES: Readonly<Record<DialogKind, string>> = {
  render: '書き出し',
  settings: 'プロジェクト設定',
  preferences: '環境設定',
  history: '変更履歴',
  'new-shot': '新規 Shot',
  shortcuts: 'キーボードショートカット',
}

const MEDIUM: ReadonlySet<DialogKind> = new Set(['history', 'shortcuts', 'new-shot', 'preferences'])

/**
 * ワークベンチのダイアログ（UI-WORKBENCH §3.3 / §3.4）。殻は 1 つ、中身を差し替えるだけ。
 * 同時に開くのは 1 つ。開いている間もワークベンチは mount されたまま。
 */
export const WorkbenchDialogs = ({
  onHistoryChanged,
}: {
  readonly onHistoryChanged: () => void
}) => {
  const workbench = useWorkbench()
  const dialog = workbench.dialog
  return (
    <WorkbenchDialog
      open={dialog !== null}
      title={dialog === null ? '' : TITLES[dialog]}
      onClose={workbench.closeDialog}
      guardUnsaved={dialog === 'settings' || dialog === 'new-shot'}
      size={dialog !== null && MEDIUM.has(dialog) ? 'medium' : 'large'}
    >
      {dialog === 'render' && <RenderDialogBody />}
      {dialog === 'settings' && <SettingsDialogBody />}
      {dialog === 'preferences' && <PreferencesDialogBody />}
      {dialog === 'history' && <HistoryDialogBody onUndone={onHistoryChanged} />}
      {dialog === 'new-shot' && <NewShotDialogBody />}
      {dialog === 'shortcuts' && <ShortcutList />}
    </WorkbenchDialog>
  )
}
