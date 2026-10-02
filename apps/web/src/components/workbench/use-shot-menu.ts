'use client'

import type { Shot } from '@ixa/domain'
import { useMemo } from 'react'
import {
  splitAtPlayhead,
  splitBlockerOf,
  unselectAdoptedTake,
} from '@/components/workbench/shot-edit-actions'
import { useContextMenuHost, type ContextMenuItem } from '@/components/workbench/ui/context-menu'
import { useCancelGeneration } from '@/components/workbench/use-cancel-generation'
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
          ...(entry.keepLabel === undefined ? {} : { keepLabel: entry.keepLabel }),
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
  const client = useMemo(() => createApiClient(), [])
  const generation = useCancelGeneration(client)

  /** その Shot のメニューの行。再生位置は**作る瞬間に**描き直さずに読む（再生中にパネルを毎コマ描き直さない）。 */
  const itemsFor = (shot: Shot, check?: ShotMenuCheck): readonly ContextMenuItem[] => {
    const atSec = workbench.transportControls.getTransport().currentSec
    const run: Record<ShotMenuAction, () => void | Promise<void>> = {
      'make-take': () => {
        workbench.selectShot(shot.id)
        workbench.openInspector('generate')
      },
      'cancel-generation': () => generation.cancel(shot),
      'open-compare': () => {
        workbench.selectShot(shot.id)
        workbench.focusPanel('compare')
      },
      'draw-start-frame': () => {
        client
          .generateStartFrame(shot.id)
          .then(() => {
            workbench.notify(`${shot.code} の絵コンテの画像を作り始めました（「使う AI」の画像の AI で）。`)
          })
          .catch((cause: unknown) => {
            workbench.notify(`${shot.code} の絵コンテの画像を作れませんでした: ${describeForPerson(cause)}`)
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
    return toMenuItems(entries, run)
  }

  /** 右クリックした Shot を選び、その Shot のメニューを開く。 */
  const open = (shot: Shot, at: MenuPoint, origin: HTMLElement, check?: ShotMenuCheck): void => {
    workbench.selectShot(shot.id)
    host.open({ label: `Shot ${shot.code} の操作`, items: itemsFor(shot, check), at, origin })
  }

  /** カードのボタンから生成をやめる（右クリックと同じ確認）。置き場の外では null。 */
  return { itemsFor, open, askCancelGeneration: generation.ask }
}
