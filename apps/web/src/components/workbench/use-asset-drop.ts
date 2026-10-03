'use client'

import { CharacterId, LocationId, type Shot } from '@ixa/domain'
import { useMemo, useState } from 'react'
import type { DragEvent } from 'react'
import { useAssets } from '@/components/workbench/asset-store'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import {
  ASSET_DRAG_TYPE,
  castWithCharacter,
  parseAssetDrag,
} from '@/lib/asset-actions'

export type AssetDropState = 'idle' | 'over' | 'saving'

/**
 * ツリーの素材を Shot へ落として割り当てる（UI-WORKBENCH-2 §4.1 / 8.5）。
 * キャラクター → 登場人物に足す（既定の Look）。ロケーション → その Shot のロケーションにする。
 * ストーリーボードのカードと Shot 一覧の行が同じ口を使う。
 */
export const useAssetDrop = (onMessage: (message: string) => void) => {
  const workbench = useWorkbench()
  const { characters, locations, actions } = useAssets()
  const api = useMemo(() => createApiClient(), [])
  const [target, setTarget] = useState<{
    readonly shotId: Shot['id']
    readonly state: AssetDropState
  } | null>(null)

  const assign = async (shot: Shot, raw: string): Promise<void> => {
    const payload = parseAssetDrag(raw)
    if (payload === null) return
    setTarget({ shotId: shot.id, state: 'saving' })
    try {
      if (payload.kind === 'location') {
        const id = LocationId.parse(payload.id)
        await workbench.saveShot(shot.id, { locationId: id })
        const name =
          (locations.state === 'ready' ? locations.value : []).find((l) => l.id === id)?.name ?? ''
        onMessage(`${shot.code} のロケーションを「${name}」にしました。`)
      } else {
        const characterId = CharacterId.parse(payload.id)
        // 既定の Look で入れる。Look が無い（画像だけで作った古い）キャラクターは「基本」を作ってから（制作者 2026-10-04）。
        const look = await actions.ensureDefaultLook(characterId)
        const name =
          (characters.state === 'ready' ? characters.value : []).find((c) => c.id === characterId)
            ?.displayName ?? ''
        const current = (await api.listShotCast(shot.id)).map((entry) => ({
          characterId: entry.characterId,
          lookId: entry.lookId,
          prominence: entry.prominence,
          order: entry.order,
        }))
        const next = castWithCharacter(current, characterId, look.id)
        if (next === null) {
          onMessage(`${name} は ${shot.code} に既に出ています。`)
          return
        }
        await api.replaceShotCast(shot.id, next)
        // インスペクターの登場人物を読み直させる（serverEpoch が進む）。
        workbench.refresh()
        onMessage(`${shot.code} に ${name}（${look.name}）を足しました。`)
      }
    } catch (cause) {
      onMessage(`${shot.code} に割り当てられませんでした: ${describeForPerson(cause)}`)
    } finally {
      setTarget(null)
    }
  }

  /** カードや行に付ける。素材のドラッグ以外（ファイルなど）には反応しない。 */
  const handlers = (shot: Shot) => ({
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (![...event.dataTransfer.types].includes(ASSET_DRAG_TYPE)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'link'
      if (target?.shotId !== shot.id) setTarget({ shotId: shot.id, state: 'over' })
    },
    onDragLeave: () => {
      setTarget((current) =>
        current?.shotId === shot.id && current.state === 'over' ? null : current,
      )
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      const raw = event.dataTransfer.getData(ASSET_DRAG_TYPE)
      if (raw === '') return
      event.preventDefault()
      void assign(shot, raw)
    },
  })

  const stateOf = (shotId: Shot['id']): AssetDropState =>
    target?.shotId === shotId ? target.state : 'idle'

  return { handlers, stateOf }
}
