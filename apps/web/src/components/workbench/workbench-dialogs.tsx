'use client'

import { AiSetupDialogBody } from '@/components/workbench/dialogs/ai-setup-dialog'
import { AlignLyricsDialogBody } from '@/components/workbench/dialogs/align-lyrics-dialog'
import { DeleteShotsDialogBody } from '@/components/workbench/dialogs/delete-shots-dialog'
import { MergeShotsDialogBody } from '@/components/workbench/dialogs/merge-shots-dialog'
import { HistoryDialogBody } from '@/components/workbench/dialogs/history-dialog'
import { LibraryImportDialogBody } from '@/components/workbench/dialogs/library-import-dialog'
import { NewShotDialogBody } from '@/components/workbench/dialogs/new-shot-dialog'
import { PreferencesDialogBody } from '@/components/workbench/dialogs/preferences-dialog'
import { RenderDialogBody } from '@/components/workbench/dialogs/render-dialog'
import { SettingsDialogBody } from '@/components/workbench/dialogs/settings-dialog'
import { ShortcutList } from '@/components/workbench/dialogs/shortcuts-dialog'
import type { RenderWatch } from '@/components/workbench/use-render-watch'
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
  'delete-shots': 'Shot を削除',
  'merge-shots': 'Shot を結合',
  'ai-setup': '使う AI',
  'align-lyrics': 'Shot の境目を歌い出しに揃える',
  'library-import': 'ほかのプロジェクトから取り込む',
}

const MEDIUM: ReadonlySet<DialogKind> = new Set([
  'history',
  'shortcuts',
  'new-shot',
  'preferences',
  'delete-shots',
  'merge-shots',
  'ai-setup',
  'library-import',
])

/**
 * ワークベンチのダイアログ（UI-WORKBENCH §3.3 / §3.4）。殻は 1 つ、中身を差し替えるだけ。
 * 同時に開くのは 1 つ。開いている間もワークベンチは mount されたまま。
 */
export const WorkbenchDialogs = ({
  onHistoryChanged,
  renderWatch,
}: {
  readonly onHistoryChanged: () => void
  /**
   * 走っている書き出しの見守り。**ダイアログの外で作ったものを渡す。**
   * 中で作るとダイアログを閉じた瞬間に追跡が止まる。
   */
  readonly renderWatch: RenderWatch
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
      {dialog === 'render' && <RenderDialogBody watch={renderWatch} />}
      {dialog === 'settings' && <SettingsDialogBody />}
      {dialog === 'preferences' && <PreferencesDialogBody />}
      {dialog === 'history' && <HistoryDialogBody onUndone={onHistoryChanged} />}
      {dialog === 'new-shot' && <NewShotDialogBody />}
      {dialog === 'shortcuts' && <ShortcutList />}
      {dialog === 'delete-shots' && <DeleteShotsDialogBody />}
      {dialog === 'merge-shots' && <MergeShotsDialogBody />}
      {dialog === 'ai-setup' && <AiSetupDialogBody />}
      {dialog === 'align-lyrics' && <AlignLyricsDialogBody />}
      {dialog === 'library-import' && <LibraryImportDialogBody />}
    </WorkbenchDialog>
  )
}
