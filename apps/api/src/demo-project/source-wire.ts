import {
  BrandAsset,
  Character,
  CharacterId,
  CharacterIdentityImage,
  CharacterLook,
  CharacterLookImage,
  Location,
  MusicAnalysis,
  MusicTrack,
  NarrationLine,
  NarrationTake,
  Project,
  Sequence,
  Shot,
  ShotCharacter,
  ShotReference,
  Take,
  TakeId,
  TextStylePreset,
  TimelineClip,
  Transition,
  VoiceProfile,
} from '@ixa/domain'
import { z } from 'zod'
import type { DuplicationSource } from '../project-duplication/read-source.js'

/**
 * 見本の目録の `source`（JSON）と、作品の複製が書く形（`DuplicationSource`）の行き来（ADR-0067）。
 *
 * **ドメインのスキーマをそのまま使い、日時の列だけを文字から Date へ戻す**（画面の `api-schemas.ts` の
 * `z.coerce.date()` と同じ考え）。Take の外した印（Set）は JSON では配列で持つ。
 * ここに置くのは `DuplicationSource` が API の型だから（domain は API の型を知らない）。
 */

/** キャラクターの Look と画像。複製は書くときに元の作品から読むが、見本には元の作品が無いので目録に持つ。 */
export const CharacterAssets = z.object({
  characterId: CharacterId,
  identityImages: z.array(CharacterIdentityImage),
  looks: z.array(z.object({ look: CharacterLook, images: z.array(CharacterLookImage) })),
})
export type CharacterAssets = z.infer<typeof CharacterAssets>

/** 見本の中身。複製が読む形に、キャラクターの Look と画像を足したもの。 */
export type DemoSource = DuplicationSource & { readonly characterAssets: readonly CharacterAssets[] }

/** 名前を挙げた列の文字を Date にしてから、ドメインのスキーマで確かめる（refine 付きのスキーマにも使える）。 */
const withDates = <T extends z.ZodTypeAny>(schema: T, keys: readonly string[]) =>
  z.preprocess((value: unknown) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
    const record = value as Readonly<Record<string, unknown>>
    return {
      ...record,
      ...Object.fromEntries(
        keys.flatMap((key) => {
          const text = record[key]
          return typeof text === 'string' ? [[key, new Date(text)] as const] : []
        }),
      ),
    }
  }, schema)

const CREATED = ['createdAt'] as const
const CREATED_UPDATED = ['createdAt', 'updatedAt'] as const

const DemoSourceWire = z.object({
  project: withDates(Project, CREATED_UPDATED),
  concept: z.string().nullable(),
  tracks: z.array(z.object({ track: MusicTrack, analyses: z.array(withDates(MusicAnalysis, CREATED)) })),
  characters: z.array(withDates(Character, CREATED)),
  locations: z.array(Location),
  brandAssets: z.array(BrandAsset),
  textStyles: z.array(withDates(TextStylePreset, CREATED_UPDATED)),
  clips: z.array(withDates(TimelineClip, CREATED)),
  sequences: z.array(Sequence),
  shots: z.array(
    z.object({
      shot: withDates(Shot, ['lockedAt', ...CREATED_UPDATED]),
      cast: z.array(ShotCharacter),
      frames: z.array(ShotReference),
      takes: z.array(withDates(Take, CREATED)),
      hiddenTakeIds: z.array(TakeId).transform((ids) => new Set(ids)),
    }),
  ),
  transitions: z.array(Transition),
  voices: z.array(withDates(VoiceProfile, CREATED_UPDATED)),
  narrationLines: z.array(withDates(NarrationLine, CREATED_UPDATED)),
  narrationTakes: z.array(withDates(NarrationTake, CREATED)),
  characterAssets: z.array(CharacterAssets),
})

/** 目録の `source` を読む。合わなければ投げる（どの列が合わないかを添える。値は添えない）。 */
export const parseDemoSource = (json: unknown): DemoSource => {
  const parsed = DemoSourceWire.safeParse(json)
  if (!parsed.success) {
    const where = parsed.error.issues
      .slice(0, 5)
      .map((issue) => issue.path.join('.'))
      .join(', ')
    throw new Error(`見本の目録の中身が作品の形に合いません（${where}）`, { cause: parsed.error })
  }
  return parsed.data
}

/** 書き出す側: 見本の中身を JSON の木にする（日時は ISO の文字、外した印は配列）。 */
export const serializeDemoSource = (source: DemoSource): Record<string, unknown> =>
  z.record(z.unknown()).parse(
    JSON.parse(
      JSON.stringify({
        ...source,
        shots: source.shots.map((shot) => ({ ...shot, hiddenTakeIds: [...shot.hiddenTakeIds].sort() })),
      }),
    ),
  )
