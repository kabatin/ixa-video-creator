'use client'

import type { DockviewApi } from 'dockview-react'
import { useRouter } from 'next/navigation'
import { MenuBar } from '@/components/workbench/menu-bar'
import { useSelectedShot, useWorkbench } from '@/components/workbench/workbench-context'
import { Button } from '@/components/ui/button'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { formatSpan } from '@/lib/format-time'
import { buildMenus, type MenuCommand, type MenuItem } from '@/lib/menu-model'
import { deleteConfirmMessage } from '@/lib/wording'
import {
  PRESETS,
  PRESET_LABELS,
  PRESET_PANELS,
  applyPreset,
  type PanelId,
} from '@/lib/workbench-layout'
import {
  BOTTOM_TABS,
  MAIN_TABS,
  SIDE_TABS,
  workbenchHref,
} from '@/lib/workbench-url'

export type WorkbenchMenuProps = {
  readonly canUndo: boolean
  readonly onUndo: () => void
  readonly onResetLayout: () => void
  readonly onNotice: (message: string) => void
  readonly dock: React.RefObject<DockviewApi | null>
  /** ドックが変わるたびに進む。見えているタブを読み直す合図（値そのものは使わない）。 */
  readonly dockEpoch: number
}

/** 区画の中でいま見えているタブ。無ければ null。 */
const visibleOf = <T extends PanelId>(dock: DockviewApi | null, ids: readonly T[]): T | null =>
  ids.find((id) => dock?.getPanel(id)?.api.isVisible === true) ?? null

/**
 * メニューバーの配線（UI-WORKBENCH §4）。中身と有効判定は `menu-model.ts`、ここは実行するだけ。
 * 右端: 作業モード（構成 / 仕上げ）・歯車（プロジェクト設定）・主ボタン「書き出し」。
 */
export const WorkbenchMenu = ({ canUndo, onUndo, onResetLayout, onNotice, dock }: WorkbenchMenuProps) => {
  const router = useRouter()
  const workbench = useWorkbench()
  const current = useSelectedShot()

  const menus = buildMenus({
    hasCurrentShot: current !== null,
    checkedCount: workbench.checked.size,
    canUndo,
  })

  /** いまの見た目から作ったリンク。**URL を操作のたびに書き換えないので、共有はここから。** */
  const copyLink = (): void => {
    const href = workbenchHref(workbench.projectId, {
      shot: workbench.selectedShotId,
      main: visibleOf(dock.current, MAIN_TABS),
      bottom: visibleOf(dock.current, BOTTOM_TABS),
      side: visibleOf(dock.current, SIDE_TABS),
    })
    const url = `${window.location.origin}${href}`
    navigator.clipboard
      .writeText(url)
      .then(() => {
        onNotice(`リンクをコピーしました: ${url}`)
      })
      .catch((cause: unknown) => {
        // 書けない環境がある（権限・非 https）。リンクそのものは見せて、手で写せるようにする。
        onNotice(`コピーできませんでした（${describeError(cause)}）。リンク: ${url}`)
      })
  }

  const deleteCurrent = (): void => {
    if (current === null) return
    const target = `Shot ${current.code} ${formatSpan(current.startSec, current.durationSec)}`
    if (!window.confirm(deleteConfirmMessage(target))) return
    createApiClient()
      .deleteShot(current.id)
      .then(() => {
        onNotice(`${current.code} を削除しました。`)
        workbench.refresh()
      })
      .catch((cause: unknown) => {
        onNotice(`${current.code} を削除できませんでした: ${describeError(cause)}`)
      })
  }

  const COMMANDS: Readonly<Record<MenuCommand, () => void>> = {
    undo: onUndo,
    redo: () => undefined,
    'reset-layout': onResetLayout,
    'copy-link': copyLink,
    'delete-shot': deleteCurrent,
    // 一括の操作バーは Shot 一覧の下にある。チェックした行と同じ場所で決めさせる。
    'bulk-edit': () => {
      workbench.focusPanel('shots')
    },
    'bulk-generate': () => {
      workbench.focusPanel('shots')
    },
    'generate-shot': () => {
      workbench.openInspector('generate')
    },
  }

  const select = (item: MenuItem): void => {
    const action = item.action
    switch (action.kind) {
      case 'href':
        router.push(action.href)
        return
      case 'dialog':
        workbench.openDialog(action.dialog)
        return
      case 'panel':
        workbench.focusPanel(action.panel)
        return
      case 'command':
        COMMANDS[action.command]()
    }
  }

  const activePreset = PRESETS.find((preset) =>
    PRESET_PANELS[preset].every((id) => dock.current?.getPanel(id)?.api.isVisible === true),
  )

  return (
    <MenuBar
      menus={menus}
      onSelect={select}
      trailing={
        <>
          <div role="group" aria-label="作業モード" className="flex rounded-md ring-1 ring-line-strong">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                aria-pressed={activePreset === preset}
                onClick={() => {
                  if (dock.current !== null) applyPreset(dock.current, preset)
                  else PRESET_PANELS[preset].forEach((id) => {
                    workbench.focusPanel(id)
                  })
                }}
                className={`h-6 px-2 text-xs first:rounded-l-md last:rounded-r-md ${
                  activePreset === preset ? 'bg-surface-2 font-semibold text-text' : 'text-muted hover:text-text'
                }`}
              >
                {PRESET_LABELS[preset]}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label="プロジェクト設定"
            title="プロジェクト設定"
            onClick={() => {
              workbench.openDialog('settings')
            }}
            className="inline-flex h-6 min-w-6 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-text"
          >
            ⚙
          </button>
          <Button
            tone="primary"
            size="sm"
            onClick={() => {
              workbench.openDialog('render')
            }}
          >
            書き出し
          </Button>
        </>
      }
    />
  )
}
