import {
  doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex,
} from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type {
  ReferenceRole, ReferenceSourceKind, ShotCamera, ShotCharacter, ShotSourceType,
  ShotStatus, TransitionType,
} from '@ixa/domain'
import {
  ReferenceRole as ReferenceRoleSchema,
  ReferenceSourceKind as ReferenceSourceKindSchema,
  ShotStatus as ShotStatusSchema,
  TransitionType as TransitionTypeSchema,
} from '@ixa/domain'
import { createdAt, deletedAt, seconds, timestampTz, ulidPk, ulidRef, updatedAt } from './columns.js'
import { characterLooks, characters } from './character.js'
import { locations } from './library.js'
import { takes } from './generation.js'
import { mediaAssets } from './media.js'
import { sequences } from './script.js'
import { projects } from './workspace.js'

/**
 * DOMAIN.md §9 Shot — 最重要ドメイン。
 * Shot がマスタータイムライン VIDEO1 上の位置を所有する（ADR-0002）。
 * duration_sec は編集尺。生成尺は Take.spec.durationSec（ADR-0011）。
 * order は 1000 刻みで採番し、挿入時に再採番しない（ARCHITECTURE.md §19）。
 */
export const shots = pgTable(
  'shots',
  {
    id: ulidPk(),
    projectId: ulidRef('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sequenceId: ulidRef('sequence_id').references(() => sequences.id, { onDelete: 'set null' }),
    order: integer('order').notNull(),
    /** 'shot_014' — 人間が呼ぶ名前。プロジェクト内一意。 */
    code: text('code').notNull(),

    // タイミング（秒）
    startSec: seconds('start_sec').notNull(),
    durationSec: seconds('duration_sec').notNull(),
    /** 採用 Take のメディア内開始オフセット。Take を差し替えても維持する（ADR-0011）。 */
    sourceInSec: seconds('source_in_sec').notNull().default(0),

    // 演出
    description: text('description').notNull().default(''),
    dialogue: text('dialogue'),
    camera: jsonb('camera').$type<ShotCamera>().notNull(),
    mood: text('mood'),

    /**
     * 場所。ひと続きのカットなので 1 つだけ（ADR-0015）。
     * 参照中のロケーションを消せると Shot が実在しない場所を指すため restrict。
     */
    locationId: ulidRef('location_id').references(() => locations.id, { onDelete: 'restrict' }),

    /** 生成方式。判別共用体なので JSONB。 */
    sourceType: jsonb('source_type').$type<ShotSourceType>().notNull(),

    /** 循環参照（shots ⇄ takes）のため AnyPgColumn で型を切る */
    selectedTakeId: ulidRef('selected_take_id').references((): AnyPgColumn => takes.id, {
      onDelete: 'set null',
    }),
    status: text('status', { enum: ShotStatusSchema.options }).$type<ShotStatus>().notNull(),
    /** ロック中は自動再生成の対象外 */
    lockedAt: timestampTz('locked_at'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('shots_project_id_order_idx').on(t.projectId, t.order),
    uniqueIndex('shots_project_id_code_uidx').on(t.projectId, t.code),
  ],
)

/** DOMAIN.md §9 ShotCharacter。look_id は必須（解決済みの値を保存する）。 */
export const shotCharacters = pgTable(
  'shot_characters',
  {
    shotId: ulidRef('shot_id')
      .notNull()
      .references(() => shots.id, { onDelete: 'cascade' }),
    characterId: ulidRef('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'restrict' }),
    lookId: ulidRef('look_id')
      .notNull()
      .references(() => characterLooks.id, { onDelete: 'restrict' }),
    prominence: text('prominence', { enum: ['primary', 'secondary', 'background'] })
      .$type<ShotCharacter['prominence']>()
      .notNull(),
    order: integer('order').notNull(),
  },
  (t) => [primaryKey({ columns: [t.shotId, t.characterId] })],
)

/** DOMAIN.md §9 ShotReference。derived_* は ReferenceResolver が自動生成する。 */
export const shotReferences = pgTable(
  'shot_references',
  {
    id: ulidPk(),
    shotId: ulidRef('shot_id')
      .notNull()
      .references(() => shots.id, { onDelete: 'cascade' }),
    mediaAssetId: ulidRef('media_asset_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'restrict' }),
    role: text('role', { enum: ReferenceRoleSchema.options }).$type<ReferenceRole>().notNull(),
    /** 0..1。Provider が重み非対応なら順位付けに使う */
    weight: doublePrecision('weight').notNull().default(1),
    order: integer('order').notNull(),
    sourceKind: text('source_kind', { enum: ReferenceSourceKindSchema.options })
      .$type<ReferenceSourceKind>()
      .notNull(),
  },
  (t) => [index('shot_references_shot_id_idx').on(t.shotId)],
)

/** DOMAIN.md §9 Transition。Shot 同士は重ならず、重なりはここが表現する。 */
export const transitions = pgTable(
  'transitions',
  {
    id: ulidPk(),
    projectId: ulidRef('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    fromShotId: ulidRef('from_shot_id')
      .notNull()
      .references(() => shots.id, { onDelete: 'cascade' }),
    toShotId: ulidRef('to_shot_id')
      .notNull()
      .references(() => shots.id, { onDelete: 'cascade' }),
    type: text('type', { enum: TransitionTypeSchema.options }).$type<TransitionType>().notNull(),
    /** cut は 0 */
    durationSec: seconds('duration_sec').notNull().default(0),
  },
  (t) => [uniqueIndex('transitions_from_shot_id_to_shot_id_uidx').on(t.fromShotId, t.toShotId)],
)
