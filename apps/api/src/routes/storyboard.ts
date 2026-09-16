import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type {
  MusicAnalysisRepository,
  MusicTrackRepository,
  ProjectRepository,
  SequenceRepository,
  ShotRepository,
} from '@ixa/db'
import {
  MusicTrackId as MusicTrackIdSchema,
  ProjectId as ProjectIdSchema,
  SequenceId as SequenceIdSchema,
  allocateShots,
  type CreateShotInput,
  type MusicAnalysis,
  type MusicSection,
  type ProjectId,
  type ShotSlot,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, VALIDATION_ERROR_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, ok, successResponse } from '../response.js'
import { ShotResponse, toShotResponse } from './shots.js'

/**
 * 音楽セクションから Shot の時間枠を一括で作る（ADR-0017 / P3-4）。
 * ADR-0006 に従い zod スキーマとハンドラを 1 ファイルに同居させる。
 *
 * **時間を決めるのは `allocateShots`（純粋関数）。** ここはその前後、
 * 入力の取り出しと Shot 列の組み立てだけを行う。割り方の規則をここに書かない。
 */

export const ANALYSIS_REQUIRED_MESSAGE =
  'この楽曲はまだ解析されていません。先に解析を実行してください'
export const SECTION_OUT_OF_RANGE_MESSAGE = '指定されたセクションが解析結果にありません'
export const FOREIGN_TRACK_MESSAGE = 'この Project に属する楽曲ではありません'
export const FOREIGN_SEQUENCE_MESSAGE = 'この Project に属する Sequence ではありません'

/** Shot コードの連番の桁数。`CHORUS-01` のような形にする。 */
const CODE_SEQ_DIGITS = 2

const AllocateBody = z
  .object({
    musicTrackId: MusicTrackIdSchema,
    /** 解析結果 `sections` の添字。ラベルは重複しうるので添字で指す。 */
    sectionIndex: z.number().int().nonnegative(),
    requestedCount: z.number().int().positive(),
    /** 1 = 拍、0.5 = 8分、0.25 = 16分。 */
    subdivision: z.union([z.literal(1), z.literal(0.5), z.literal(0.25)]).default(1),
    /** 割った Shot をまとめる Sequence。省略なら未所属。 */
    sequenceId: SequenceIdSchema.nullable().default(null),
  })
  .openapi('AllocateShotsInput')

const AllocateResult = z
  .object({
    shots: z.array(ShotResponse),
    requestedCount: z.number().int().positive(),
    createdCount: z.number().int().positive(),
    section: z
      .object({ index: z.number().int().nonnegative(), label: z.string() })
      .openapi('AllocatedSection'),
    /**
     * グリッドが要求カット数を支えられず減らしたときの理由。
     * **画面に出すために返す。** 黙って減らすと利用者が気づかない（ADR-0017）。
     */
    warnings: z.array(z.string()),
  })
  .openapi('AllocateShotsResult')

const ProjectParams = z.object({
  projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }),
})

const jsonContent = <T extends z.ZodTypeAny>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
})

const allocateRoute = createRoute({
  method: 'post', path: '/projects/{projectId}/storyboard/shots', tags: ['storyboard'],
  summary: '音楽セクションを Shot へ割る',
  request: {
    params: ProjectParams,
    body: { required: true, content: { 'application/json': { schema: AllocateBody } } },
  },
  responses: {
    201: jsonContent('作成された Shot 列', successResponse(AllocateResult)),
    404: errorContent('対象が存在しない'),
    422: errorContent('入力の検証に失敗した'),
    500: errorContent('サーバ内部エラー'),
  },
})

/** `CHORUS-01` のような、人が読んで並び順が分かるコード。 */
const shotCode = (section: MusicSection, indexInSection: number): string =>
  `${section.label.toUpperCase()}-${String(indexInSection + 1).padStart(CODE_SEQ_DIGITS, '0')}`

/**
 * 時間枠を Shot の作成入力にする。
 * 決まっているのは時間と所属だけで、演出（description / camera / mood）は
 * **空のまま残す**。ここで機械的に埋めると、人が書いたのか自動なのか区別できなくなる。
 */
const toCreateInput = (
  projectId: ProjectId,
  sequenceId: z.infer<typeof SequenceIdSchema> | null,
  section: MusicSection,
  slot: ShotSlot,
  indexInSection: number,
  order: number,
): CreateShotInput => ({
  projectId,
  sequenceId,
  order,
  code: shotCode(section, indexInSection),
  startSec: slot.startSec,
  durationSec: slot.durationSec,
  sourceInSec: 0,
  description: '',
  dialogue: null,
  camera: {
    size: 'medium',
    angleH: null,
    angle: null,
    lensMm: null,
    movement: null,
    movementIntensity: null,
  },
  mood: null,
  locationId: null,
  sourceType: { type: 'ai_video' },
  status: 'draft',
})

export type StoryboardRoutesDeps = {
  shots: ShotRepository
  musicTracks: MusicTrackRepository
  musicAnalyses: MusicAnalysisRepository
  sequences: SequenceRepository
  /** Project の実在確認だけに使う。 */
  projects: ProjectRepository
}

export const storyboardRoutes = (deps: StoryboardRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook }).openapi(allocateRoute, async (c) => {
    const { projectId } = c.req.valid('param')
    if ((await deps.projects.findById(projectId)) === null) {
      return c.json(fail(NOT_FOUND_MESSAGE), 404)
    }

    const input = c.req.valid('json')

    const track = await deps.musicTracks.findById(input.musicTrackId)
    if (track === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
    /**
     * 他 Project の楽曲で割れてしまうと、**別の曲のビートに載った Shot** が
     * 静かに混ざる。経路の Project と突き合わせて弾く。
     */
    if (track.projectId !== projectId) {
      return c.json(fail(VALIDATION_ERROR_MESSAGE, { musicTrackId: [FOREIGN_TRACK_MESSAGE] }), 422)
    }

    if (input.sequenceId !== null) {
      const sequences = await deps.sequences.findByProject(projectId)
      if (!sequences.some((sequence) => sequence.id === input.sequenceId)) {
        return c.json(
          fail(VALIDATION_ERROR_MESSAGE, { sequenceId: [FOREIGN_SEQUENCE_MESSAGE] }),
          422,
        )
      }
    }

    const analysis: MusicAnalysis | null = await deps.musicAnalyses.findByTrack(input.musicTrackId)
    if (analysis === null) {
      return c.json(fail(VALIDATION_ERROR_MESSAGE, { musicTrackId: [ANALYSIS_REQUIRED_MESSAGE] }), 422)
    }

    const section = analysis.sections[input.sectionIndex]
    if (section === undefined) {
      return c.json(
        fail(VALIDATION_ERROR_MESSAGE, { sectionIndex: [SECTION_OUT_OF_RANGE_MESSAGE] }),
        422,
      )
    }

    /**
     * `allocateShots` は入力が不正なら RangeError を投げる。
     * 尺 0 のセクションなどはここで 422 にする（500 にすると原因が読めない）。
     */
    let allocated
    try {
      allocated = allocateShots({
        sectionStartSec: section.start,
        sectionEndSec: section.end,
        beats: analysis.beats,
        subdivision: input.subdivision,
        requestedCount: input.requestedCount,
      })
    } catch (error) {
      if (error instanceof RangeError) {
        return c.json(fail(VALIDATION_ERROR_MESSAGE, { requestedCount: [error.message] }), 422)
      }
      throw error
    }

    // 既存の Shot の後ろに積む。order は Project 内で連続させる。
    const existing = await deps.shots.findByProject(projectId)
    const nextOrder = existing.reduce((max, shot) => Math.max(max, shot.order + 1), 0)

    const created = await deps.shots.createMany(
      allocated.slots.map((slot, index) =>
        toCreateInput(projectId, input.sequenceId, section, slot, index, nextOrder + index),
      ),
    )

    return c.json(
      ok({
        shots: created.map(toShotResponse),
        requestedCount: allocated.requestedCount,
        createdCount: created.length,
        section: { index: input.sectionIndex, label: section.label },
        warnings: allocated.reducedReason === null ? [] : [allocated.reducedReason],
      }),
      201,
    )
  })
