'use client'

import type { Shot } from '@ixa/domain'
import { useOptionalContextMenuHost } from '@/components/workbench/ui/context-menu'
import { useWorkbench } from '@/components/workbench/workbench-context'
import {
  CANCEL_GENERATION_CONFIRM,
  CANCEL_GENERATION_LABEL,
  KEEP_GENERATING_LABEL,
} from '@/lib/context-menus'
import type { GenerationActivityApi } from '@/lib/generation-activity-api'

/**
 * 生成をやめる（制作者 2026-10-01「動画生成をキャンセル出来るようにしたい、もし出来るならUIが分かりづらい」）。
 *
 * 右クリックのメニュー・生成中の行・ストーリーボードのカードが同じ処理を使う。
 * **失敗は投げる**（確認の殻が理由を出す。`ContextMenuHost`）。止めたら Shot をサーバの決め直しで置き換える。
 */
export const useCancelGeneration = (api: Pick<GenerationActivityApi, 'cancelGenerations'>) => {
  const workbench = useWorkbench()
  const host = useOptionalContextMenuHost()

  const cancel = async (shot: Shot): Promise<void> => {
    const result = await api.cancelGenerations(shot.id)
    workbench.replaceShots([result.shot])
    workbench.notify(
      result.cancelledJobIds.length === 0
        ? `${shot.code} で動いている生成はありませんでした。`
        : `${shot.code} の生成をやめました。`,
    )
  }

  /** ボタンから。右クリックのメニューと同じ確認を挟む。置き場の外では null（ボタンを出さない）。 */
  const ask =
    host === null
      ? null
      : (shot: Shot): void => {
          host.perform({
            kind: 'item',
            id: 'cancel-generation',
            label: CANCEL_GENERATION_LABEL,
            disabledReason: null,
            confirm: CANCEL_GENERATION_CONFIRM,
            keepLabel: KEEP_GENERATING_LABEL,
            run: () => cancel(shot),
          })
        }

  return { cancel, ask }
}
