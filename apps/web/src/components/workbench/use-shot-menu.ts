'use client'

import type { Shot } from '@ixa/domain'
import {
  splitAtPlayhead,
  splitBlockerOf,
  unselectAdoptedTake,
} from '@/components/workbench/shot-edit-actions'
import { useContextMenuHost, type ContextMenuItem } from '@/components/workbench/ui/context-menu'
import type { MenuPoint } from '@/components/workbench/use-context-menu'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import { shotMenuEntries, type ContextMenuEntry, type ShotMenuAction } from '@/lib/context-menus'

/** 中身（データ）に実行を結び付ける。アクションの無い行は作らない。 */
export const toMenuItems = <A extends string>(
  entries: readonly ContextMenuEntry<A>[],
  run: Readonly<Record<A, () => void | Promise<void>>>,
): readonly ContextMenuItem[] =>
  entries.map((entry) =>
    entry.kind === 'separator'
      ? entry
      : {
          kind: 'item',
          id: entry.action,
          label: entry.label,
          disabledReason: entry.disabledReason,
          run: run[entry.action],
          ...(entry.shortcut === undefined ? {} : { shortcut: entry.shortcut }),
          ...(entry.confirm === undefined ? {} : { confirm: entry.confirm }),
        },
  )

/** Shot 一覧だけが渡す、チェックの状態と付け外し。 */
export type ShotMenuCheck = { readonly checked: boolean; readonly toggle: () => void }

/**
 * Shot の右クリックのメニューを開く口（タイムライン・ストーリーボード・Shot 一覧で共通）。
 * **右クリックした Shot を選び、その Shot に対して動く**（チェックした複数とは混ぜない）。操作はすべて既存のもの。
 */
export const useShotMenu = () => {
  const workbench = useWorkbench()
  const host = useContextMenuHost()

  return (shot: Shot, at: MenuPoint, origin: HTMLElement, check?: ShotMenuCheck): void => {
    // 再生位置は開いた瞬間だけ要る。描き直さずに読む（`useTransport` だと再生中にパネルが毎コマ描き直される）。
    const atSec = workbench.transportControls.getTransport().currentSec
    workbench.selectShot(shot.id)
    const run: Record<ShotMenuAction, () => void> = {
      'make-take': () => {
        workbench.openInspector('generate')
      },
      'open-compare': () => {
        workbench.focusPanel('compare')
      },
      'draw-start-frame': () => {
        createApiClient()
          .generateStartFrame(shot.id)
          .then(() => {
            workbench.notify(
              `${shot.code} の絵コンテの画像を作り始めました（「使う AI」の画像の AI で）。`,
            )
          })
          .catch((cause: unknown) => {
            workbench.notify(
              `${shot.code} の絵コンテの画像を作れませんでした: ${describeForPerson(cause)}`,
            )
          })
      },
      split: () => {
        splitAtPlayhead(workbench, shot, atSec)
      },
      'unselect-take': () => {
        unselectAdoptedTake(workbench, shot, workbench.notify)
      },
      'toggle-check': () => {
        check?.toggle()
      },
      delete: () => {
        workbench.openDialog('delete-shots', { shotIds: [shot.id] })
      },
    }
    const entries = shotMenuEntries({
      shot,
      splitBlocker: splitBlockerOf(shot, atSec),
      ...(check === undefined ? {} : { checked: check.checked }),
    })
    host.open({ label: `Shot ${shot.code} の操作`, items: toMenuItems(entries, run), at, origin })
  }
}
