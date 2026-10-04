import {
  ImageGenerationJobId,
  ImageGenerationJobStatus,
  type CharacterId,
  type CharacterIdentityImageId,
} from '@ixa/domain'
import { z } from 'zod'
import type { Requester } from '@/lib/requester'

/**
 * 手本の画像 1 枚からキャラクターシート（四面図）を作る口（ADR-0035。制作者 2026-10-03「動画生成に役立つ形式の
 * キャラクターシートを 1 枚の画像から作れるといい」）。作るのは worker（Codex は 1 枚 1 分ほど）。
 *
 * ```
 * POST /characters/{id}/character-sheet  作り始める（202。手本が無ければ 422、作っている最中は 409）
 * GET  /characters/{id}/character-sheet  直近のジョブの状態（開き直しても「作っています」を出すため）
 * ```
 */

export const WireCharacterSheetState = z.object({
  job: z
    .object({ id: ImageGenerationJobId, status: ImageGenerationJobStatus, error: z.string().nullable() })
    .nullable(),
})
export type WireCharacterSheetState = z.infer<typeof WireCharacterSheetState>

export const WireCharacterSheetStarted = z.object({ jobId: ImageGenerationJobId })

export type CharacterSheetApi = {
  readonly getCharacterSheet: (characterId: CharacterId) => Promise<WireCharacterSheetState>
  /** 手本を省略すると、キャラクターシート以外の主の画像（無ければ最初の 1 枚）を使う。 */
  readonly startCharacterSheet: (
    characterId: CharacterId,
    referenceIdentityImageId?: CharacterIdentityImageId,
  ) => Promise<z.infer<typeof WireCharacterSheetStarted>>
}

const path = (characterId: CharacterId): string => `/characters/${encodeURIComponent(characterId)}/character-sheet`

export const createCharacterSheetApi = (requester: Requester): CharacterSheetApi => ({
  getCharacterSheet: async (characterId) => requester.get(path(characterId), WireCharacterSheetState),
  startCharacterSheet: async (characterId, referenceIdentityImageId) =>
    requester.post(
      path(characterId),
      referenceIdentityImageId === undefined ? {} : { referenceIdentityImageId },
      WireCharacterSheetStarted,
    ),
})
