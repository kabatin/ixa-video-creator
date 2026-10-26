import { sql } from 'drizzle-orm'
import {
  boolean, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex,
} from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type {
  DialogueLine, ReferenceRole, ReferenceSourceKind, ShotCamera, ShotCharacter, ShotSourceType,
  ShotContinuityMode, ShotStatus, TransitionType,
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
    /** Take の長さが尺と違うときの扱い。`fit` は速度を変えて尺に収める（ADR-0026）。 */
    timing: text('timing', { enum: ['trim', 'fit'] }).notNull().default('trim'),
    /** 再生の速さ（ADR-0050）。`trim` の Shot だけが使う。 */
    speed: doublePrecision('speed').notNull().default(1),
    /**
     * 採用 Take の音（ADR-0060）。大きさ 0〜2 と消音。消音の **null は自動**（セリフのある Shot だけ鳴らす）。
     * 前からある Shot も新しい Shot も自動で始まる（セリフの無い MV は鳴らないまま）。
     */
    takeAudioVolume: doublePrecision('take_audio_volume').notNull().default(1),
    takeAudioMuted: boolean('take_audio_muted'),

    // 演出
    description: text('description').notNull().default(''),
    /** セリフの行（ADR-0059）。並びがしゃべる順。無ければ空の配列。 */
    dialogue: jsonb('dialogue').$type<DialogueLine[]>().notNull().default([]),
    camera: jsonb('camera').$type<ShotCamera>().notNull(),
    mood: text('mood'),
    continuityMode: text('continuity_mode', { enum: ['independent', 'previous_shot'] })
      .$type<ShotContinuityMode>()
      .notNull()
      .default('independent'),

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
    // 一意は生きている行だけ。消した Shot のコードは作り直しで再び使えてよい（2026-09-26）。
    uniqueIndex('shots_project_id_code_uidx').on(t.projectId, t.code).where(sql`${t.deletedAt} is null`),
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
