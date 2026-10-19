import {
  DbNotFoundError,
  type BrandAssetRepository,
  type CharacterRepository,
  type LocationRepository,
  type TextStyleRepository,
  type VoiceProfileRepository,
} from '@ixa/db'
import type { EditBatchAssetEdit } from '@ixa/domain'
import { isUniqueViolation } from './unique-violation.js'

/**
 * 素材の記録（`assetEdits`）を戻す。**消したものは同じ ID・同じ中身で論理削除を外し**、作ったものは論理削除し、
 * 直したものは変えた欄だけを書き戻す。戻せなかったものは理由を返す（握り潰さない。1 件の失敗で残りを止めもしない）。
 */

type Writable<I, P, E> = {
  readonly update: (id: I, patch: P) => Promise<E>
  readonly softDelete: (id: I) => Promise<void>
  readonly restore: (id: I) => Promise<E | null>
}

export type AssetUndoDeps = {
  readonly characters?: Pick<CharacterRepository, 'update' | 'softDelete' | 'restore'>
  readonly locations?: Pick<LocationRepository, 'update' | 'softDelete' | 'restore'>
  readonly brandAssets?: Pick<BrandAssetRepository, 'update' | 'softDelete' | 'restore'>
  readonly voices?: Pick<VoiceProfileRepository, 'update' | 'softDelete' | 'restore'>
  readonly textStyles?: Pick<TextStyleRepository, 'update' | 'softDelete' | 'restore'>
}

export const ASSET_UNAVAILABLE_REASON = 'この素材を戻す口がありません'
export const ASSET_ALREADY_REMOVED_REASON = '素材は既に消されています'
export const ASSET_NOT_REMOVED_REASON = '素材は既に戻っているか、見つかりません'
export const ASSET_NAME_TAKEN_REASON = '同じ名前のものが後から作られているので戻せません（どちらかの名前を変えてください）'

const undoWith = async <I, P, E>(
  repo: Writable<I, P, E> | undefined,
  op: EditBatchAssetEdit['op'],
  id: I,
  before: P | undefined,
): Promise<string | null> => {
  if (repo === undefined) return ASSET_UNAVAILABLE_REASON
  if (op === 'create') {
    try {
      await repo.softDelete(id)
      return null
    } catch (cause) {
      if (cause instanceof DbNotFoundError) return ASSET_ALREADY_REMOVED_REASON
      throw cause
    }
  }
  if (op === 'delete') return (await repo.restore(id)) === null ? ASSET_NOT_REMOVED_REASON : null
  if (before !== undefined) await repo.update(id, before)
  return null
}

const undoOne = (deps: AssetUndoDeps, edit: EditBatchAssetEdit): Promise<string | null> => {
  switch (edit.asset) {
    case 'character':
      return undoWith(deps.characters, edit.op, edit.id, edit.op === 'update' ? edit.before : undefined)
    case 'location':
      return undoWith(deps.locations, edit.op, edit.id, edit.op === 'update' ? edit.before : undefined)
    case 'brand_asset':
      return undoWith(deps.brandAssets, edit.op, edit.id, edit.op === 'update' ? edit.before : undefined)
    case 'voice':
      return undoWith(deps.voices, edit.op, edit.id, edit.op === 'update' ? edit.before : undefined)
    case 'text_style':
      return undoWith(deps.textStyles, edit.op, edit.id, edit.op === 'update' ? edit.before : undefined)
  }
}

/** **後の操作から先に戻す**。 */
export const undoAssetEdits = async (
  deps: AssetUndoDeps,
  edits: readonly EditBatchAssetEdit[],
): Promise<{
  readonly restored: readonly string[]
  readonly failed: readonly { readonly assetId: string; readonly reason: string }[]
}> => {
  const restored: string[] = []
  const failed: { assetId: string; reason: string }[] = []
  for (const edit of [...edits].reverse()) {
    try {
      const reason = await undoOne(deps, edit)
      if (reason === null) restored.push(edit.id)
      else failed.push({ assetId: edit.id, reason })
    } catch (cause) {
      // 同じ名前の声・スタイルが後から作られていると、一意制約で戻せない。DB の文は出さず、何をすればよいかを言う。
      if (isUniqueViolation(cause)) {
        failed.push({ assetId: edit.id, reason: ASSET_NAME_TAKEN_REASON })
        continue
      }
      failed.push({ assetId: edit.id, reason: `戻せませんでした: ${cause instanceof Error ? cause.message : String(cause)}` })
    }
  }
  return { restored: [...restored].reverse(), failed: [...failed].reverse() }
}
