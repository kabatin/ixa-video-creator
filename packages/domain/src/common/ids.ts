import { monotonicFactory } from 'ulid'
import { z } from 'zod'

/**
 * すべての ID は ULID（時系列ソート可能）。
 * branded type にすることで ShotId と TakeId の取り違えを型で防ぐ。
 */
/**
 * 引数 `brand` は型パラメータ B を推論させるためだけに存在する（値としては使わない）。
 * これにより呼び出し側が `brandedId('ShotId')` と書くだけで型が決まる。
 */
const brandedId = <B extends string>(brand: B) => {
  void brand
  return z.string().ulid().brand<B>()
}

export const WorkspaceId = brandedId('WorkspaceId')
export const ProjectId = brandedId('ProjectId')
export const MediaAssetId = brandedId('MediaAssetId')
export const CharacterId = brandedId('CharacterId')
export const CharacterIdentityImageId = brandedId('CharacterIdentityImageId')
export const CharacterLookId = brandedId('CharacterLookId')
export const CharacterLookImageId = brandedId('CharacterLookImageId')
export const BrandAssetId = brandedId('BrandAssetId')
export const LocationId = brandedId('LocationId')
export const MotionTemplateId = brandedId('MotionTemplateId')
export const MusicTrackId = brandedId('MusicTrackId')
export const MusicAnalysisId = brandedId('MusicAnalysisId')
export const ScriptId = brandedId('ScriptId')
export const ScriptVersionId = brandedId('ScriptVersionId')
export const SequenceId = brandedId('SequenceId')
export const ShotId = brandedId('ShotId')
export const ShotReferenceId = brandedId('ShotReferenceId')
export const TransitionId = brandedId('TransitionId')
export const TimelineClipId = brandedId('TimelineClipId')
export const GenerationJobId = brandedId('GenerationJobId')
export const TakeId = brandedId('TakeId')
export const ReviewRunId = brandedId('ReviewRunId')
export const ReviewFindingId = brandedId('ReviewFindingId')
export const StoryboardDraftRunId = brandedId('StoryboardDraftRunId')
export const StoryboardDraftItemId = brandedId('StoryboardDraftItemId')
export const EditBatchId = brandedId('EditBatchId')
export const RenderJobId = brandedId('RenderJobId')
export const TextStyleId = brandedId('TextStyleId')
export const ImageGenerationJobId = brandedId('ImageGenerationJobId')

export type WorkspaceId = z.infer<typeof WorkspaceId>
export type ProjectId = z.infer<typeof ProjectId>
export type MediaAssetId = z.infer<typeof MediaAssetId>
export type CharacterId = z.infer<typeof CharacterId>
export type CharacterIdentityImageId = z.infer<typeof CharacterIdentityImageId>
export type CharacterLookId = z.infer<typeof CharacterLookId>
export type CharacterLookImageId = z.infer<typeof CharacterLookImageId>
export type BrandAssetId = z.infer<typeof BrandAssetId>
export type LocationId = z.infer<typeof LocationId>
export type MotionTemplateId = z.infer<typeof MotionTemplateId>
export type MusicTrackId = z.infer<typeof MusicTrackId>
export type MusicAnalysisId = z.infer<typeof MusicAnalysisId>
export type ScriptId = z.infer<typeof ScriptId>
export type ScriptVersionId = z.infer<typeof ScriptVersionId>
export type SequenceId = z.infer<typeof SequenceId>
export type ShotId = z.infer<typeof ShotId>
export type ShotReferenceId = z.infer<typeof ShotReferenceId>
export type TransitionId = z.infer<typeof TransitionId>
export type TimelineClipId = z.infer<typeof TimelineClipId>
export type GenerationJobId = z.infer<typeof GenerationJobId>
export type TakeId = z.infer<typeof TakeId>
export type ReviewRunId = z.infer<typeof ReviewRunId>
export type ReviewFindingId = z.infer<typeof ReviewFindingId>
export type StoryboardDraftRunId = z.infer<typeof StoryboardDraftRunId>
export type StoryboardDraftItemId = z.infer<typeof StoryboardDraftItemId>
export type EditBatchId = z.infer<typeof EditBatchId>
export type RenderJobId = z.infer<typeof RenderJobId>
export type TextStyleId = z.infer<typeof TextStyleId>
export type ImageGenerationJobId = z.infer<typeof ImageGenerationJobId>

/**
 * ID の発行器。**同じミリ秒でも必ず増える**（`monotonicFactory`）。
 *
 * 素の `ulid()` は同じミリ秒だと乱数部がそのつど独立なので、
 * **続けて作った 2 件の大小が入れ替わる。** ARCHITECTURE.md §19 は
 * 「主キーは ULID（時系列ソート性が欲しい）」と書いており、
 * `orderBy(desc(id))` で「最新の 1 件」を引く口がいくつもある
 * （ReviewRun / GenerationJob / StoryboardDraftRun）。
 * 入れ替わると、作り直した直後に**古い方が「最新」として返る。**
 * 実際に絵コンテ下書きのテストが同じミリ秒で落ちて分かった。
 *
 * 単調性はこのプロセスの中でのみ保証される。プロセスをまたぐ場合は
 * ミリ秒のタイムスタンプが順序を決める。
 */
const nextUlid = monotonicFactory()

/** 新しい ID を発行する。呼び出し側でスキーマを指定して型を確定させる。 */
export const newId = <T extends z.ZodType<string>>(schema: T): z.infer<T> =>
  schema.parse(nextUlid())
