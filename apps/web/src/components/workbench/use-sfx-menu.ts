'use client'

import { usePromptViewer } from '@/components/prompt/prompt-viewer-provider'
import { useContextMenuHost } from '@/components/workbench/ui/context-menu'
import { useContextMenuTrigger } from '@/components/workbench/use-context-menu'
import { toMenuItems } from '@/components/workbench/use-shot-menu'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { sfxMenuEntries } from '@/lib/context-menus'
import { promptViewFromSfx } from '@/lib/prompt-view'
import type { SfxTreeItem } from '@/lib/sfx-tree'

/**
 * 効果音の素材の右クリック（素材ツリー）。AI で作った音にだけ「プロンプトを見る」を出す。
 * 消す・直すは置いたクリップの方なので、ここには並べない。
 */
export const useSfxMenu = () => {
  const workbench = useWorkbench()
  const host = useContextMenuHost()
  const promptViewer = usePromptViewer()

  const promptOf = (item: SfxTreeItem) => promptViewFromSfx(item.label, item.source ?? null)

  /** メニューに並べるものがあるか（無ければ右クリックを受けない）。 */
  const has = (item: SfxTreeItem): boolean => promptViewer !== null && promptOf(item) !== null

  const trigger = useContextMenuTrigger<SfxTreeItem>((item, at, origin) => {
    const view = promptOf(item)
    if (view === null || promptViewer === null) return
    workbench.inspect({ kind: 'sfx', id: item.mediaAssetId })
    const items = toMenuItems(sfxMenuEntries({ hasPrompt: true }), {
      'view-prompt': () => {
        promptViewer.open(view)
      },
    })
    host.open({ label: `${item.label} の操作`, items, at, origin })
  })

  return { has, trigger }
}
