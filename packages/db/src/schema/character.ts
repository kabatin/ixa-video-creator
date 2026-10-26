import { boolean, doublePrecision, index, integer, pgTable, text, uniqueIndex, type AnyPgColumn } from 'drizzle-orm/pg-core'
import type { IdentityImageRole, LookImageRole } from '@ixa/domain'
import {
  IdentityImageRole as IdentityImageRoleSchema,
  LookImageRole as LookImageRoleSchema,
} from '@ixa/domain'
import { createdAt, deletedAt, ulidPk, ulidRef } from './columns.js'
import { mediaAssets } from './media.js'
import { voiceProfiles } from './narration.js'
import { projects, workspaces } from './workspace.js'

/** DOMAIN.md §5 Character — 同一性のみ。時系列で変わる外見は character_looks。 */
export const characters = pgTable(
  'characters',
  {
    id: ulidPk(),
    workspaceId: ulidRef('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** 持ち主のプロジェクト（ADR-0034）。別のプロジェクトで使うときは取り込み（複製）。 */
    projectId: ulidRef('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description').notNull().default(''),

    identityAnchors: text('identity_anchors').array().notNull().default([]),
    styleTokens: text('style_tokens').array().notNull().default([]),
    colorPalette: text('color_palette').array().notNull().default([]),

    /**
     * 話し手の番号（ADR-0059）。作品の中で作った順に 1, 2…。**消しても詰めない**（論理削除の行も数える）。
     * 振るのはリポジトリの `create` だけ。
     */
    speakerNo: integer('speaker_no').notNull(),
    /** 英語の呼び名（H3 のセリフの文に一字一句入る）。 */
    speechName: text('speech_name'),
    /** 声の説明（英語）。 */
    voiceDescription: text('voice_description'),
    /**
     * セリフの声（ADR-0062）。声の差し替えでこの人の行を読み直す声。声を消すと null に戻る。
     * 声の表は character を指すので、こちらは遅らせて引く（互いに指し合う）。
     */
    dialogueVoiceProfileId: ulidRef('dialogue_voice_profile_id').references((): AnyPgColumn => voiceProfiles.id, {
      onDelete: 'set null',
    }),
    /** 距離の既定（dB）。行ごとの指定が無い行に足す。 */
    dialogueLevelDb: doublePrecision('dialogue_level_db').notNull().default(0),

    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('characters_workspace_id_idx').on(t.workspaceId),
    index('characters_project_id_idx').on(t.projectId),
    // 同じ作品で番号が重なると、2 人が同じ声の印（S1）になる。
    uniqueIndex('characters_project_speaker_no_uq').on(t.projectId, t.speakerNo),
  ],
)

export const characterIdentityImages = pgTable(
  'character_identity_images',
  {
    id: ulidPk(),
    characterId: ulidRef('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    mediaAssetId: ulidRef('media_asset_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'restrict' }),
    role: text('role', { enum: IdentityImageRoleSchema.options }).$type<IdentityImageRole>().notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    order: integer('order').notNull(),
  },
  (t) => [index('character_identity_images_character_id_idx').on(t.characterId)],
)

export const characterLooks = pgTable(
  'character_looks',
  {
    id: ulidPk(),
    characterId: ulidRef('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    /** Shot からはこのキーで指定する（'IXA_CUP_PAST' など）。Character 内で一意。 */
    key: text('key').notNull(),
    name: text('name').notNull(),
    era: text('era'),
    description: text('description').notNull().default(''),

    wardrobeTokens: text('wardrobe_tokens').array().notNull().default([]),
    styleTokens: text('style_tokens').array().notNull().default([]),
    colorPalette: text('color_palette').array().notNull().default([]),

    isDefault: boolean('is_default').notNull().default(false),

    /** 最初に承認された Take の 1 フレームを昇格させた canonical reference。 */
    canonicalFrameAssetId: ulidRef('canonical_frame_asset_id').references(
      () => mediaAssets.id,
      { onDelete: 'set null' },
    ),
    deletedAt: deletedAt(),
  },
  (t) => [uniqueIndex('character_looks_character_id_key_uidx').on(t.characterId, t.key)],
)

export const characterLookImages = pgTable(
  'character_look_images',
  {
    id: ulidPk(),
    lookId: ulidRef('look_id')
      .notNull()
      .references(() => characterLooks.id, { onDelete: 'cascade' }),
    mediaAssetId: ulidRef('media_asset_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'restrict' }),
    role: text('role', { enum: LookImageRoleSchema.options }).$type<LookImageRole>().notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    order: integer('order').notNull(),
  },
  (t) => [index('character_look_images_look_id_idx').on(t.lookId)],
)
