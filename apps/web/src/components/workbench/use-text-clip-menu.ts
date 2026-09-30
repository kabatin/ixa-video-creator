'use client'

import type { TimelineClip } from '@ixa/domain'
import { useContextMenuHost, type ContextMenuItem } from '@/components/workbench/ui/context-menu'
import type { MenuPoint } from '@/components/workbench/use-context-menu'
import { toMenuItems } from '@/components/workbench/use-shot-menu'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { createApiClient } from '@/lib/api-client'
import { textClipMenuEntries, type TextClipMenuAction } from '@/lib/context-menus'
import { formatSpan } from '@/lib/format-time'
import { readTextClipParams } from '@/lib/text-style-form'

type ClipLike = Pick<TimelineClip, 'id' | 'startSec' | 'durationSec' | 'content'>

const textOf = (clip: ClipLike): string =>
  readTextClipParams(clip.content.type === 'text' ? clip.content.params : null)?.text ?? ''

/**
 * テロップの右クリックのメニュー（帯）と、インスペクターの「…」の中身（2026-09-30）。
 * 中身は `textClipMenuEntries` 1 か所。削除は確認を挟み、消したら読み直す。
 */
export const useTextClipMenu = () => {
  const workbench = useWorkbench()
  const host = useContextMenuHost()

  const itemsFor = (
    clip: ClipLike,
    where: 'timeline' | 'inspector',
  ): readonly ContextMenuItem[] => {
    const run: Record<TextClipMenuAction, () => void | Promise<void>> = {
      edit: () => {
        workbench.inspect({ kind: 'text-clip', id: clip.id })
        workbench.focusPanel('inspector')
      },
      delete: async () => {
        await createApiClient().deleteClip(clip.id)
        workbench.inspect(null)
        workbench.refresh()
      },
    }
    const entries = textClipMenuEntries({
      text: textOf(clip),
      span: formatSpan(clip.startSec, clip.durationSec),
      where,
    })
    return toMenuItems(entries, run)
  }

  /** 右クリックしたテロップを選び、そのテロップのメニューを開く。 */
  const open = (clip: ClipLike, at: MenuPoint, origin: HTMLElement): void => {
    workbench.inspect({ kind: 'text-clip', id: clip.id })
    host.open({
      label: `テロップ「${textOf(clip)}」の操作`,
      items: itemsFor(clip, 'timeline'),
      at,
      origin,
    })
  }

  return { itemsFor, open }
}
