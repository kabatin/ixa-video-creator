'use client'

import { goToMasterTrack, goToProjectConcept } from '@/components/workbench/workbench-navigation'
import type { DockviewApi } from 'dockview-react'
import { useRouter } from 'next/navigation'
import { MenuBar } from '@/components/workbench/menu-bar'
import {
  mergeBlockerOf,
  splitAtPlayhead,
  splitBlockerOf,
  unselectAdoptedTake,
} from '@/components/workbench/shot-edit-actions'
import { undoConfirmMessage, type UndoState } from '@/components/workbench/use-edit-history'
import { WorkbenchDialog } from '@/components/workbench/workbench-dialog'
import { useSelectedShot, useTransport, useWorkbench } from '@/components/workbench/workbench-context'
import { VolumeControl } from '@/components/workbench/volume-control'
import { Button } from '@/components/ui/button'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { assetFolderNotice, createAssetFolderApi } from '@/lib/asset-folder-api'
import { createRequester } from '@/lib/requester'
import { buildMenus, type MenuCommand, type MenuItem } from '@/lib/menu-model'
import {
  PRESETS,
  PRESET_LABELS,
  PRESET_PANELS,
  applyPreset,
  type PanelId,
} from '@/lib/workbench-layout'
import { BOTTOM_TABS, MAIN_TABS, SIDE_TABS, workbenchHref } from '@/lib/workbench-url'

export type WorkbenchMenuProps = {
  /**
   * 「元に戻す」の状態一式（`useEditHistory`）。**boolean ではない。**
   * 名前が `canUndo` なのは `project-workbench.tsx` の配線を変えないため（同ファイルは別作業中）。
   */
  readonly canUndo: UndoState
  /** 「元に戻す」を**求める**だけ。実行はこのあとの確認ダイアログで決まる。 */
  readonly onUndo: () => void
  readonly onResetLayout: () => void
  readonly onNotice: (message: string) => void
  readonly dock: React.RefObject<DockviewApi | null>
  /** ドックが変わるたびに進む。見えているタブを読み直す合図（値そのものは使わない）。 */
  readonly dockEpoch: number
  /** 「ファイルを取り込む…」。ファイル選択を開く。 */
  readonly onImportFiles: () => void
}

/** 区画の中でいま見えているタブ。無ければ null。 */
const visibleOf = <T extends PanelId>(dock: DockviewApi | null, ids: readonly T[]): T | null =>
  ids.find((id) => dock?.getPanel(id)?.api.isVisible === true) ?? null

/**
 * メニューバーの配線（UI-WORKBENCH §4）。中身と有効判定は `menu-model.ts`、ここは実行するだけ。
 * 右端: 作業モード（構成 / 仕上げ）・歯車（プロジェクト設定）・主ボタン「書き出し」。
 */
export const WorkbenchMenu = ({
  canUndo: undo,
  onUndo,
  onResetLayout,
  onNotice,
  dock,
  onImportFiles,
}: WorkbenchMenuProps) => {
  const router = useRouter()
  const workbench = useWorkbench()
  // 分割できるかは再生位置で変わる。メニューの帯だけが毎フレーム描き直す（ワークベンチ全体は巻き込まない）。
  const transport = useTransport()
  const current = useSelectedShot()

  const menus = buildMenus({
    hasCurrentShot: current !== null,
    checkedCount: workbench.checked.size,
    canUndo: undo.availability,
    currentHasTake: (current?.selectedTakeId ?? null) !== null,
    splitBlocker: splitBlockerOf(current, transport.currentSec),
    mergeBlocker: mergeBlockerOf(
      (workbench.shots ?? []).filter((shot) => workbench.checked.has(shot.id)),
    ),
  })

  /**
   * 確認の「戻す」。**ここが押されるまで取り消しの API は呼ばれない。**
   * 複数 Shot に及び、やり直しも無い操作なので、⌘Z もメニューもこの 1 箇所を通す。
   */
  const runUndo = (): void => {
    void undo.confirm().then((message) => {
      onNotice(message)
      workbench.refresh()
    })
  }

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

  const unselectTake = (): void => {
    if (current === null) return
    unselectAdoptedTake(workbench, current, onNotice)
  }

  /**
   * 作った素材を Finder で開く（ADR-0041）。開く前に、まだ入っていない素材が入る。
   * 置き場が手元のファイルでないとこの口は無いので、そのときは理由をそのまま伝える。
   */
  const openAssetFolder = (): void => {
    createAssetFolderApi(createRequester(resolveApiBaseUrl()))
      .openAssetFolder(workbench.projectId)
      .then((opened) => {
        const notice = assetFolderNotice(opened)
        if (notice !== null) onNotice(notice)
      })
      .catch((cause: unknown) => {
        onNotice(`素材フォルダを開けませんでした（${describeError(cause)}）`)
      })
  }

  const COMMANDS: Readonly<Record<MenuCommand, () => void>> = {
    undo: onUndo,
    redo: () => undefined,
    'reset-layout': onResetLayout,
    'copy-link': copyLink,
    'unselect-take': unselectTake,
    'split-shot': () => {
      splitAtPlayhead(workbench, current, transport.currentSec)
    },
    'import-files': onImportFiles,
    'open-asset-folder': openAssetFolder,
    'inspect-master-track': () => {
      goToMasterTrack(workbench, onNotice)
    },
    'inspect-project': () => {
      goToProjectConcept(workbench)
    },
    // 一括の操作バーは Shot 一覧の下にある。チェックした行と同じ場所で決めさせる。
    'bulk-edit': () => {
      workbench.focusPanel('shots')
    },
    'bulk-generate': () => {
      workbench.focusPanel('shots')
    },
    'bulk-draw': () => {
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
    <>
      <WorkbenchDialog
        open={undo.pending !== null}
        title="一括操作を元に戻す"
        size="medium"
        onClose={undo.cancel}
      >
        <p className="text-sm text-text">
          {undo.pending === null ? '' : undoConfirmMessage(undo.pending)}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" onClick={undo.cancel}>
            やめる
          </Button>
          <Button size="sm" tone="danger" onClick={runUndo}>
            戻す
          </Button>
        </div>
      </WorkbenchDialog>
      <MenuBar
        menus={menus}
        onSelect={select}
        title={workbench.project.name}
        trailing={
          <>
            {/* 音量は作業モードの左。以前はステータスバーにあり、目が行かなかった。 */}
            <VolumeControl />
            <div
              role="group"
              aria-label="作業モード"
              className="flex rounded-md ring-1 ring-line-strong"
            >
              {PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={activePreset === preset}
                  onClick={() => {
                    if (dock.current !== null) applyPreset(dock.current, preset)
                    else
                      PRESET_PANELS[preset].forEach((id) => {
                        workbench.focusPanel(id)
                      })
                  }}
                  className={`h-6 px-2 text-xs first:rounded-l-md last:rounded-r-md ${
                    activePreset === preset
                      ? 'bg-surface-2 font-semibold text-text'
                      : 'text-muted hover:text-text'
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
    </>
  )
}
