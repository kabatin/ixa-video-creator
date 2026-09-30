'use client'

import { readyOr, useAssets } from '@/components/workbench/asset-store'
import { useContextMenuHost, type ContextMenuItem } from '@/components/workbench/ui/context-menu'
import type { MenuPoint } from '@/components/workbench/use-context-menu'
import { toMenuItems } from '@/components/workbench/use-shot-menu'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { assetMenuEntries, type AssetMenuAction } from '@/lib/context-menus'
import type { Inspected } from '@/lib/workbench-selection'

/** 素材ツリーに並ぶ物（Shot・テロップ以外）。 */
export type AssetTarget = Exclude<Inspected, { kind: 'shot' | 'text-clip' }>

type Resolved = {
  readonly name: string
  readonly isDefaultLook?: boolean
  readonly isMaster?: boolean
}

/**
 * 素材の右クリックのメニュー（素材ツリー）と、インスペクターの「…」の中身（2026-09-30）。
 * 中身は `assetMenuEntries` 1 か所。削除は確認を挟み、消したら選択を外す。
 */
export const useAssetMenu = () => {
  const workbench = useWorkbench()
  const host = useContextMenuHost()
  const { characters, looks, locations, brandAssets, tracks, actions } = useAssets()

  /** 名前と状態。見つからなければ null（消えた・まだ読めていない）。 */
  const resolve = (target: AssetTarget): Resolved | null => {
    switch (target.kind) {
      case 'character': {
        const found = readyOr(characters).find((item) => item.id === target.id)
        return found === undefined ? null : { name: found.displayName }
      }
      case 'look': {
        const found = (looks.get(target.characterId) ?? []).find((item) => item.id === target.id)
        return found === undefined ? null : { name: found.name, isDefaultLook: found.isDefault }
      }
      case 'location': {
        const found = readyOr(locations).find((item) => item.id === target.id)
        return found === undefined ? null : { name: found.name }
      }
      case 'brand-asset': {
        const found = readyOr(brandAssets).find((item) => item.id === target.id)
        return found === undefined ? null : { name: found.name }
      }
      case 'track': {
        const found = readyOr(tracks).find((item) => item.id === target.id)
        return found === undefined ? null : { name: found.title, isMaster: found.isMaster }
      }
      case 'project':
        return { name: '作品の方針' }
    }
  }

  const remove = async (target: AssetTarget): Promise<void> => {
    switch (target.kind) {
      case 'character':
        await actions.deleteCharacter(target.id)
        break
      case 'look':
        await actions.deleteLook({ id: target.id, characterId: target.characterId })
        break
      case 'location':
        await actions.deleteLocation(target.id)
        break
      case 'brand-asset':
        await actions.deleteBrandAsset(target.id)
        break
      case 'track':
        await actions.deleteTrack(target.id)
        break
      case 'project':
        return
    }
    workbench.inspect(null)
  }

  /** その素材のメニューの行。見つからなければ null。 */
  const itemsFor = (
    target: AssetTarget,
    where: 'tree' | 'inspector',
  ): readonly ContextMenuItem[] | null => {
    const resolved = resolve(target)
    if (resolved === null) return null
    const run: Record<AssetMenuAction, () => void | Promise<void>> = {
      'open-viewer': () => {
        workbench.inspect(target)
        workbench.openViewer()
      },
      inspect: () => {
        workbench.inspect(target)
        workbench.focusPanel('inspector')
      },
      'set-default-look': async () => {
        if (target.kind === 'look') await actions.updateLook(target.id, { isDefault: true })
      },
      'set-master': async () => {
        if (target.kind === 'track') await actions.setMasterTrack(target.id)
      },
      reanalyze: async () => {
        if (target.kind === 'track') await actions.analyzeTrack(target.id)
      },
      delete: () => remove(target),
    }
    const entries = assetMenuEntries({
      kind: target.kind,
      name: resolved.name,
      where,
      ...(resolved.isDefaultLook === undefined ? {} : { isDefaultLook: resolved.isDefaultLook }),
      ...(resolved.isMaster === undefined ? {} : { isMaster: resolved.isMaster }),
    })
    return toMenuItems(entries, run)
  }

  /** 右クリックした素材を選び、その素材のメニューを開く。 */
  const open = (target: AssetTarget, at: MenuPoint, origin: HTMLElement): void => {
    const items = itemsFor(target, 'tree')
    const resolved = resolve(target)
    if (items === null || resolved === null) return
    workbench.inspect(target)
    host.open({ label: `${resolved.name} の操作`, items, at, origin })
  }

  return { itemsFor, open }
}
