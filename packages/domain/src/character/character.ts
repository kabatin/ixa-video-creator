import { z } from 'zod'
import {
  CharacterId, CharacterIdentityImageId, CharacterLookId,
  CharacterLookImageId, MediaAssetId, ProjectId, VoiceProfileId, WorkspaceId,
} from '../common/ids.js'
import { MAX_DUB_LEVEL_DB, MIN_DUB_LEVEL_DB } from '../dub/dialogue-dub.js'

/**
 * 四面図（正面/側面/背面/斜めを 1 枚に集約したターンアラウンドシート）。
 * Veo と Runway は参照画像を 3 枚しか受け付けないため、
 * 個別画像ではなく四面図 1 枚で渡すことで参照枠を節約する（ARCHITECTURE.md §8）。
 */
export const IdentityImageRole = z.enum([
  'four_view', 'face_front', 'face_side', 'face_three_quarter', 'full_body', 'profile',
])
export type IdentityImageRole = z.infer<typeof IdentityImageRole>

export const LookImageRole = z.enum(['wardrobe', 'hair', 'full_body', 'reference_still'])
export type LookImageRole = z.infer<typeof LookImageRole>

export const MAX_SPEECH_NAME_LENGTH = 60
export const MAX_VOICE_DESCRIPTION_LENGTH = 300

/** 空白だけは「未設定」（null）に揃える。H3 の文に空の呼び名を入れないため。 */
const OptionalEnglishText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .default(null)
    .transform((value) => (value === null || value === '' ? null : value))

/**
 * Character は「同一性」だけを持つ。時系列で変わる外見は CharacterLook が持つ。
 * プロンプト断片を役割ごとに分けるのは、再生成時に部分調整できるようにするため。
 */
export const Character = z.object({
  id: CharacterId,
  workspaceId: WorkspaceId,
  /** 持ち主のプロジェクト（ADR-0034）。別のプロジェクトで使うときは取り込み（複製）。 */
  projectId: ProjectId,
  name: z.string().min(1).max(100),
  displayName: z.string().min(1).max(200),
  description: z.string().default(''),

  identityAnchors: z.array(z.string()).default([]),
  styleTokens: z.array(z.string()).default([]),
  colorPalette: z.array(z.string()).default([]),

  /**
   * 話し手の番号（ADR-0059）。作品の中で作った順に 1, 2… と振る固定の番号で、**消しても詰めない**。
   * H3 のセリフの話し手の印（S1, S2…）になる。番号が Shot ごとに変わると声が入れ替わるため、
   * 振るのはリポジトリだけ（作成の入力にも PATCH にも無い）。
   */
  speakerNo: z.number().int().positive(),
  /** 英語の呼び名（例 The cat）。H3 のセリフの文に**一字一句そのまま**入る。未設定は null。 */
  speechName: OptionalEnglishText(MAX_SPEECH_NAME_LENGTH),
  /** 声の説明（英語。例 a calm, deep, refined elderly gentleman's voice）。全 Shot で同じ文になる。 */
  voiceDescription: OptionalEnglishText(MAX_VOICE_DESCRIPTION_LENGTH),
  /**
   * セリフの声（ADR-0062）。声の差し替えで、この人の行を読み直す声（同じ作品の声のプロファイル）。
   * null は未設定（差し替えの前に理由を出して止める）。声を消すと null に戻る。
   */
  dialogueVoiceProfileId: VoiceProfileId.nullable().default(null),
  /** 距離の既定（dB。ADR-0062）。差し替えた声を、元の声と同じ大きさにしてから足す。行ごとの `dub.levelDb` が優先。 */
  dialogueLevelDb: z.number().finite().min(MIN_DUB_LEVEL_DB).max(MAX_DUB_LEVEL_DB).default(0),

  createdAt: z.date(),
})
export type Character = z.infer<typeof Character>

export const CharacterIdentityImage = z.object({
  id: CharacterIdentityImageId,
  characterId: CharacterId,
  mediaAssetId: MediaAssetId,
  role: IdentityImageRole,
  isPrimary: z.boolean().default(false),
  order: z.number().int().nonnegative(),
})
export type CharacterIdentityImage = z.infer<typeof CharacterIdentityImage>

export const CharacterLook = z.object({
  id: CharacterLookId,
  characterId: CharacterId,
  key: z.string().regex(/^[A-Z0-9_]+$/, 'key は大文字英数とアンダースコアのみ'),
  name: z.string().min(1),
  era: z.string().nullable(),
  description: z.string().default(''),

  wardrobeTokens: z.array(z.string()).default([]),
  styleTokens: z.array(z.string()).default([]),
  colorPalette: z.array(z.string()).default([]),

  isDefault: z.boolean().default(false),

  /**
   * この Look の canonical reference。
   * 最初に承認された Take の 1 フレームを昇格させ、以降の全 Shot で使ってドリフトを止める。
   */
  canonicalFrameAssetId: MediaAssetId.nullable(),
})
export type CharacterLook = z.infer<typeof CharacterLook>

/**
 * キャラクターを作ると一緒にできる既定の Look（DOMAIN.md §5「Character は最低 1 つの isDefault な Look を持つ」）。
 * Shot の登場人物は Look が必須なので、Look が無いと Shot に入れられない（制作者 2026-10-04）。
 */
export const DEFAULT_LOOK = Object.freeze({ key: 'BASE', name: '基本' })

export const CharacterLookImage = z.object({
  id: CharacterLookImageId,
  lookId: CharacterLookId,
  mediaAssetId: MediaAssetId,
  role: LookImageRole,
  isPrimary: z.boolean().default(false),
  order: z.number().int().nonnegative(),
})
export type CharacterLookImage = z.infer<typeof CharacterLookImage>

// ---------------------------------------------------------------------------
// リポジトリの入力型（ADR-0007: 契約は Domain が定義する）
// ---------------------------------------------------------------------------

/** `speakerNo` はリポジトリが振る（作品の中の固定の番号。入力では受けない）。 */
export const CreateCharacterInput = Character.omit({ id: true, createdAt: true, speakerNo: true })
export type CreateCharacterInput = z.input<typeof CreateCharacterInput>

/** workspaceId・projectId は変更できない。別のプロジェクトで使うときは取り込み（複製）にする（ADR-0034）。 */
export const UpdateCharacterPatch = Character.pick({
  name: true, displayName: true, description: true,
  identityAnchors: true, styleTokens: true, colorPalette: true,
  speechName: true, voiceDescription: true,
  dialogueVoiceProfileId: true, dialogueLevelDb: true,
}).partial()
export type UpdateCharacterPatch = z.input<typeof UpdateCharacterPatch>

export const CreateCharacterIdentityImageInput = CharacterIdentityImage.omit({ id: true })
export type CreateCharacterIdentityImageInput = z.input<typeof CreateCharacterIdentityImageInput>

/**
 * 登録時に必ず明示させる必要が無い列には既定値を持たせる。
 * API 側で `.extend()` して既定を足す回避が不要になる。
 */
export const CreateCharacterLookInput = CharacterLook.omit({ id: true }).extend({
  era: CharacterLook.shape.era.default(null),
  canonicalFrameAssetId: CharacterLook.shape.canonicalFrameAssetId.default(null),
})
export type CreateCharacterLookInput = z.input<typeof CreateCharacterLookInput>

/**
 * characterId と key は変更できない。
 * key は Shot から Look を指す識別子なので、変えると参照が切れる。
 */
export const UpdateCharacterLookPatch = CharacterLook.pick({
  name: true, era: true, description: true,
  wardrobeTokens: true, styleTokens: true, colorPalette: true,
  isDefault: true, canonicalFrameAssetId: true,
}).partial()
export type UpdateCharacterLookPatch = z.input<typeof UpdateCharacterLookPatch>

export const CreateCharacterLookImageInput = CharacterLookImage.omit({ id: true })
export type CreateCharacterLookImageInput = z.input<typeof CreateCharacterLookImageInput>
