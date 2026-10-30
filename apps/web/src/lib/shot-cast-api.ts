import { ShotCharacter, type CharacterId, type ShotId } from '@ixa/domain'
import { z } from 'zod'
import type { Requester } from '@/lib/requester'

/**
 * Shot の登場人物（`ShotCharacter` / docs/DOMAIN.md §5・§9）の呼び出し口。
 *
 * `apps/api` は import せず、経路とワイヤ形式の知識だけをここに持つ。
 * 置き換えが PUT なのは API が `replaceAll` だからで、差分ではなく常に全件を送る。
 */

/** `ShotCharacter` に日時列は無いので、ドメインのスキーマをそのまま使う。 */
export const WireShotCharacter = ShotCharacter
export type WireShotCharacter = z.infer<typeof WireShotCharacter>

export const WireShotCharacterList = z.array(WireShotCharacter)

/**
 * `PUT /shots/{shotId}/characters` の 1 件分。
 * shotId は経路が持つので本文には入れない（正を 2 つにしない）。
 */
export const ShotCastEntry = ShotCharacter.omit({ shotId: true })
export type ShotCastEntry = z.infer<typeof ShotCastEntry>

export const ReplaceShotCastBody = z.object({ entries: z.array(ShotCastEntry) })
export type ReplaceShotCastBody = z.infer<typeof ReplaceShotCastBody>

const castPath = (shotId: ShotId): string => `/shots/${encodeURIComponent(shotId)}/characters`

const memberPath = (shotId: ShotId, characterId: CharacterId): string =>
  `${castPath(shotId)}/${encodeURIComponent(characterId)}`

export type ShotCastApi = {
  /** order 昇順で返る。空配列は「誰も出ていない」であって、失敗ではない。 */
  readonly listShotCast: (shotId: ShotId) => Promise<WireShotCharacter[]>
  /** 登場人物を一括で置き換える。送らなかった人は外れる。 */
  readonly replaceShotCast: (
    shotId: ShotId,
    entries: readonly ShotCastEntry[],
  ) => Promise<WireShotCharacter[]>
  /** **紐づけを外すだけ。Character 自体は消えない。** */
  readonly unlinkShotCharacter: (shotId: ShotId, characterId: CharacterId) => Promise<void>
}

export const createShotCastApi = (requester: Requester): ShotCastApi => ({
  listShotCast: async (shotId) => requester.get(castPath(shotId), WireShotCharacterList),

  replaceShotCast: async (shotId, entries) =>
    requester.put(castPath(shotId), ReplaceShotCastBody.parse({ entries }), WireShotCharacterList),

  unlinkShotCharacter: async (shotId, characterId) =>
    requester.remove(memberPath(shotId, characterId)),
})
