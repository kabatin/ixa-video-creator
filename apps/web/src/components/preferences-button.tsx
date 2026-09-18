'use client'

import { useState } from 'react'
import { PreferencesDialogBody } from '@/components/workbench/dialogs/preferences-dialog'
import { WorkbenchDialog } from '@/components/workbench/workbench-dialog'

/**
 * サイト側ページ（プロジェクト一覧・キャラクター・素材ライブラリ）の歯車（UI-WORKBENCH §3.4）。
 * 環境設定は Project に依らないので、ワークベンチの外からも同じダイアログで開く。
 */
export const PreferencesButton = () => {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        aria-label="環境設定"
        title="環境設定"
        onClick={() => {
          setOpen(true)
        }}
        className="inline-flex h-7 min-w-7 items-center justify-center rounded-md border border-line text-sm text-muted hover:bg-surface-2 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        ⚙
      </button>
      <WorkbenchDialog
        open={open}
        title="環境設定"
        size="medium"
        onClose={() => {
          setOpen(false)
        }}
      >
        <PreferencesDialogBody />
      </WorkbenchDialog>
    </>
  )
}
