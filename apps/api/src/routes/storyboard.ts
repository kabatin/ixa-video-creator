import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type {
  MusicAnalysisRepository,
  MusicTrackRepository,
  ProjectRepository,
  ScriptRepository,
  SequenceRepository,
  ShotRepository,
  StoryboardDraftRepository,
} from '@ixa/db'
import {
  MusicTrackId as MusicTrackIdSchema,
  ProjectId as ProjectIdSchema,
  SequenceId as SequenceIdSchema,
  ShotId as ShotIdSchema,
  StoryboardDraftItem as StoryboardDraftItemSchema,
  StoryboardDraftRun as StoryboardDraftRunSchema,
  StoryboardDraftRunId as StoryboardDraftRunIdSchema,
  allocateShots,
  type CreateShotInput,
  type MusicAnalysis,
  type MusicSection,
  type ProjectId,
  type Shot,
  type ShotSlot,
  type StoryboardDraftItem,
  type StoryboardDraftRun,
} from '@ixa/domain'
import type {
  StoryboardDraftOutcome,
  StoryboardDraftShot,
  StoryboardDrafter,
} from '@ixa/provider-llm'
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

/** 時間を直接指定して作るときの、コード接頭辞の既定値。 */
const DEFAULT_CUT_CODE_PREFIX = 'CUT'

/**
 * 1 リクエストで受け取る区切りの上限。Shot はこれより 1 つ少なく作られる。
 *
 * **減らして通さず弾く。** 波形の上での誤操作（連打・ドラッグ）で数百の Shot が
 * 一度にできると、取り消しが現実的でなくなる。画面でも止めるが、API だけを
 * 叩かれた場合にも同じ歯止めが要る。
 */
export const MAX_CUT_BOUNDARIES = 200

export const BOUNDARIES_TOO_FEW_MESSAGE =
  '区切りは 2 個以上必要です（隣り合う 2 個で 1 カットになります）'
export const BOUNDARIES_TOO_MANY_MESSAGE = `区切りは一度に ${String(MAX_CUT_BOUNDARIES)} 個までです`
export const BOUNDARIES_NEGATIVE_MESSAGE = '区切りの時刻は 0 秒以上である必要があります'
export const BOUNDARIES_NOT_ASCENDING_MESSAGE =
  '区切りは昇順に並べ、同じ時刻を重ねないでください（尺 0 のカットになります）'
export const CODE_PREFIX_INVALID_MESSAGE = 'コードの接頭辞は英数字 1〜16 文字にしてください'

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

const CutsBody = z
  .object({
    /**
     * 波形の上で決めた区切りの時刻（秒・float）。昇順。
     * 隣り合う 2 つが 1 カットになるので、印が N 個なら Shot は N-1 個できる。
     */
    boundariesSec: z
      .array(z.number().finite().nonnegative(BOUNDARIES_NEGATIVE_MESSAGE))
      .min(2, BOUNDARIES_TOO_FEW_MESSAGE)
      .max(MAX_CUT_BOUNDARIES, BOUNDARIES_TOO_MANY_MESSAGE)
      .refine(
        (values) =>
          values.every((value, index) => index === 0 || value > (values[index - 1] as number)),
        BOUNDARIES_NOT_ASCENDING_MESSAGE,
      ),
    /** 作った Shot をまとめる Sequence。省略なら未所属。 */
    sequenceId: SequenceIdSchema.nullable().default(null),
    /** `CUT-01` の `CUT` の部分。セクション由来のラベルが無いので呼び出し側が決める。 */
    codePrefix: z
      .string()
      .regex(/^[A-Za-z0-9]{1,16}$/, CODE_PREFIX_INVALID_MESSAGE)
      .default(DEFAULT_CUT_CODE_PREFIX),
  })
  .openapi('CreateCutsInput')

/**
 * 一括作成（`AllocateShotsResult`）と揃えるが、`requestedCount` と `section` は持たない。
 *
 * 時間指定には「要求したが作れなかった数」が存在しない。支えられない入力は
 * 減らさず 422 で弾くので、`requestedCount` は常に `createdCount` と同じになる。
 * 意味の無い数を同名で返すと、**一括作成と同じく減ることがある**と読まれる。
 * `section` も同様に、由来する音楽セクションが無いため 0 埋めや null を返さない。
 *
 * `warnings` だけは残す。画面が両方の経路で同じ警告表示を使えるようにするため。
 * 現状この経路では常に空だが、それは「警告が無い」であって「見ていない」ではない。
 */
const CutsResult = z
  .object({
    shots: z.array(ShotResponse),
    createdCount: z.number().int().positive(),
    warnings: z.array(z.string()),
  })
  .openapi('CreateCutsResult')

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

const cutsRoute = createRoute({
  method: 'post', path: '/projects/{projectId}/storyboard/cuts', tags: ['storyboard'],
  summary: '波形の上で決めた区切りから Shot を作る',
  request: {
    params: ProjectParams,
    body: { required: true, content: { 'application/json': { schema: CutsBody } } },
  },
  responses: {
    201: jsonContent('作成された Shot 列', successResponse(CutsResult)),
    404: errorContent('対象が存在しない'),
    422: errorContent('入力の検証に失敗した'),
    500: errorContent('サーバ内部エラー'),
  },
})

/**
 * 区切りの列を隣接する時間枠へ畳む。
 * 尺は**次の区切りとの差**なので、隙間も重なりも構造的に作れない。
 * 昇順かつ重複なしはスキーマ側で保証済み。
 */
const toSlots = (boundariesSec: readonly number[]): readonly ShotSlot[] =>
  boundariesSec.slice(0, -1).map((startSec, index) => ({
    startSec,
    durationSec: (boundariesSec[index + 1] as number) - startSec,
  }))

/**
 * `CHORUS-01` のような、人が読んで並び順が分かるコードを**既存と衝突しないように**振る。
 *
 * `(project_id, code)` は UNIQUE。ラベルは曲中で何度も繰り返される（verse が 5 つ等）ので、
 * ラベルと枠内の連番だけで作ると**2 回目の割り当てが必ず衝突して一括作成ごと失敗する**。
 * 実際に 500 を踏んだため、使用済みを避けて採番する。
 */
const assignShotCodes = (
  prefix: string,
  count: number,
  usedCodes: ReadonlySet<string>,
): readonly string[] => {
  const codes: string[] = []
  let seq = 1

  for (let i = 0; i < count; i += 1) {
    let candidate = `${prefix}-${String(seq).padStart(CODE_SEQ_DIGITS, '0')}`
    while (usedCodes.has(candidate) || codes.includes(candidate)) {
      seq += 1
      candidate = `${prefix}-${String(seq).padStart(CODE_SEQ_DIGITS, '0')}`
    }
    codes.push(candidate)
    seq += 1
  }

  return codes
}

/**
 * 時間枠を Shot の作成入力にする。
 * 決まっているのは時間と所属だけで、演出（description / camera / mood）は
 * **空のまま残す**。ここで機械的に埋めると、人が書いたのか自動なのか区別できなくなる。
 */
const toCreateInput = (
  projectId: ProjectId,
  sequenceId: z.infer<typeof SequenceIdSchema> | null,
  code: string,
  slot: ShotSlot,
  order: number,
): CreateShotInput => ({
  projectId,
  sequenceId,
  order,
  code,
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

/**
 * 指定された Sequence が経路の Project のものか確かめる。
 * 他 Project の Sequence に Shot がぶら下がると、どの構成にも現れない Shot ができる。
 */
const isForeignSequence = async (
  deps: StoryboardRoutesDeps,
  projectId: ProjectId,
  sequenceId: z.infer<typeof SequenceIdSchema> | null,
): Promise<boolean> => {
  if (sequenceId === null) return false
  const sequences = await deps.sequences.findByProject(projectId)
  return !sequences.some((sequence) => sequence.id === sequenceId)
}

export const storyboardRoutes = (deps: StoryboardRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(allocateRoute, async (c) => {
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

      if (await isForeignSequence(deps, projectId, input.sequenceId)) {
        return c.json(fail(VALIDATION_ERROR_MESSAGE, { sequenceId: [FOREIGN_SEQUENCE_MESSAGE] }), 422)
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
      const usedCodes = new Set(existing.map((shot) => shot.code))
      const codes = assignShotCodes(section.label.toUpperCase(), allocated.slots.length, usedCodes)

      const created = await deps.shots.createMany(
        allocated.slots.map((slot, index) =>
          toCreateInput(
            projectId,
            input.sequenceId,
            codes[index] as string,
            slot,
            nextOrder + index,
          ),
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
    .openapi(cutsRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if ((await deps.projects.findById(projectId)) === null) {
        return c.json(fail(NOT_FOUND_MESSAGE), 404)
      }

      const input = c.req.valid('json')

      if (await isForeignSequence(deps, projectId, input.sequenceId)) {
        return c.json(
          fail(VALIDATION_ERROR_MESSAGE, { sequenceId: [FOREIGN_SEQUENCE_MESSAGE] }),
          422,
        )
      }

      // 既存の Shot の後ろに積む。order は Project 内で連続させる。
      const slots = toSlots(input.boundariesSec)
      const existing = await deps.shots.findByProject(projectId)
      const nextOrder = existing.reduce((max, shot) => Math.max(max, shot.order + 1), 0)
      // 採番は一括作成と同じ仕組み。`(project_id, code)` は UNIQUE なので使用済みを避ける。
      const codes = assignShotCodes(
        input.codePrefix.toUpperCase(),
        slots.length,
        new Set(existing.map((shot) => shot.code)),
      )

      const created = await deps.shots.createMany(
        slots.map((slot, index) =>
          toCreateInput(
            projectId,
            input.sequenceId,
            codes[index] as string,
            slot,
            nextOrder + index,
          ),
        ),
      )

      const warnings: string[] = []
      return c.json(
        ok({ shots: created.map(toShotResponse), createdCount: created.length, warnings }),
        201,
      )
    })

/* ─────────────────────────────────────────────────────────────────────────
 * 絵コンテの一括下書き（PHASE 6.3 / P63-4）
 *
 * **下書きは Shot を書き換えない。** 案は `storyboard_draft_items` に溜め、
 * 人が Shot ごとに採否を決める。Shot に書き込むのは採用の口だけ。
 *
 * 既存の `storyboardRoutes` とは別の factory にしてある。deps が重ならず、
 * 片方だけを組んでテストできるため（`reviews.ts` と同じく `Pick` で絞る）。
 * ───────────────────────────────────────────────────────────────────────── */

export const NO_SHOTS_MESSAGE =
  'この Project にはまだ Shot がありません。先に Shot を作ってください'
export const RUN_NOT_DONE_MESSAGE = 'この下書きはまだ完了していません'
export const DUPLICATE_SHOT_IDS_MESSAGE = '同じ Shot を 2 回指定しないでください'
export const FOREIGN_RUN_MESSAGE = 'この Project の下書きではありません'

/** 1 回の採用で受け取る Shot の上限。Project の Shot 数を超える指定に意味は無い。 */
export const MAX_ADOPT_SHOT_IDS = 500

/** 案が無い Shot を採用しようとした。**1 件でもあれば何も採用しない。** */
export const noDraftForShotsMessage = (shotIds: readonly string[]): string =>
  `この下書きに案が無い Shot が含まれています: ${shotIds.join(', ')}`

/** 既に消えている Shot を採用しようとした。 */
export const missingShotsMessage = (shotIds: readonly string[]): string =>
  `既に削除された Shot が含まれています: ${shotIds.join(', ')}`

/** 下書き 1 回分。日時は ISO8601 文字列で返す（`ReviewRunResponse` と同じ扱い）。 */
export const StoryboardDraftRunResponse = StoryboardDraftRunSchema.omit({ createdAt: true })
  .extend({ createdAt: z.string().datetime() })
  .openapi('StoryboardDraftRun')
export type StoryboardDraftRunResponse = z.infer<typeof StoryboardDraftRunResponse>

/**
 * Shot 1 件ぶんの案。
 * **`adoptedAt` の null は「まだ決めていない」**であって「不採用」ではない（lessons L-021）。
 */
export const StoryboardDraftItemResponse = StoryboardDraftItemSchema.omit({
  adoptedAt: true,
  createdAt: true,
})
  .extend({
    adoptedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
  })
  .openapi('StoryboardDraftItem')
export type StoryboardDraftItemResponse = z.infer<typeof StoryboardDraftItemResponse>

export const toStoryboardDraftRunResponse = (
  run: StoryboardDraftRun,
): StoryboardDraftRunResponse => ({ ...run, createdAt: run.createdAt.toISOString() })

export const toStoryboardDraftItemResponse = (
  item: StoryboardDraftItem,
): StoryboardDraftItemResponse => ({
  ...item,
  adoptedAt: item.adoptedAt === null ? null : item.adoptedAt.toISOString(),
  createdAt: item.createdAt.toISOString(),
})

/**
 * 実行 1 回と、その案。
 *
 * **失敗しても 201 で返す。** 呼び出し側は `run.status` と `run.error` を読む。
 * HTTP のエラーにしてしまうと、保存された失敗の run を画面が受け取れず、
 * 「押したのに何も起きなかった」と区別が付かなくなる。
 */
const StoryboardDraftResult = z
  .object({
    run: StoryboardDraftRunResponse,
    /** 失敗した run では空。`run.status` を見ずに「案 0 件」と読まないこと。 */
    items: z.array(StoryboardDraftItemResponse),
  })
  .openapi('StoryboardDraftResult')

/** 採用の結果。画面が「いまの説明」を描き直せるよう、更新後の Shot も返す。 */
const StoryboardAdoptResult = z
  .object({
    adopted: z.array(StoryboardDraftItemResponse),
    shots: z.array(ShotResponse),
  })
  .openapi('StoryboardAdoptResult')

const AdoptBody = z
  .object({
    /**
     * **採用する Shot を明示的に列挙する。** 既定で全件採用にしない。
     * 押していない Shot が変わることが、この機能でいちばん起きてはいけない事故。
     */
    shotIds: z
      .array(ShotIdSchema)
      .min(1)
      .max(MAX_ADOPT_SHOT_IDS)
      .refine((ids) => new Set(ids).size === ids.length, DUPLICATE_SHOT_IDS_MESSAGE),
  })
  .openapi('AdoptStoryboardDraftInput')

const DraftRunParams = ProjectParams.extend({
  runId: StoryboardDraftRunIdSchema.openapi({ param: { name: 'runId', in: 'path' } }),
})

const createDraftRoute = createRoute({
  method: 'post', path: '/projects/{projectId}/storyboard/drafts', tags: ['storyboard'],
  summary: '絵コンテを一括で下書きする（Shot は書き換えない）',
  request: { params: ProjectParams },
  responses: {
    201: jsonContent('下書きの実行と案', successResponse(StoryboardDraftResult)),
    404: errorContent('対象が存在しない'),
    422: errorContent('入力の検証に失敗した'),
    500: errorContent('サーバ内部エラー'),
  },
})

const adoptDraftRoute = createRoute({
  method: 'post', path: '/projects/{projectId}/storyboard/drafts/{runId}/adopt', tags: ['storyboard'],
  summary: '案を採用して Shot の説明と雰囲気を書き換える',
  request: {
    params: DraftRunParams,
    body: { required: true, content: { 'application/json': { schema: AdoptBody } } },
  },
  responses: {
    200: jsonContent('採用された案と、更新後の Shot', successResponse(StoryboardAdoptResult)),
    404: errorContent('対象が存在しない'),
    422: errorContent('入力の検証に失敗した'),
    500: errorContent('サーバ内部エラー'),
  },
})

export type StoryboardDraftRoutesDeps = {
  projects: Pick<ProjectRepository, 'findById'>
  /** 採用のときだけ `update` を使う。**下書きの作成では書かない。** */
  shots: Pick<ShotRepository, 'findByProject' | 'update'>
  scripts: Pick<ScriptRepository, 'findByProject' | 'findVersionById'>
  musicTracks: Pick<MusicTrackRepository, 'findByProject'>
  musicAnalyses: Pick<MusicAnalysisRepository, 'findByTrack'>
  drafts: Pick<
    StoryboardDraftRepository,
    'createRun' | 'updateRun' | 'addItems' | 'findRunById' | 'findItemsByRun' | 'adoptItems'
  >
  drafter: StoryboardDrafter
}

/** 現在の脚本本文。まだ書かれていなければ null（空文字に畳まない）。 */
const currentScriptContent = async (
  deps: StoryboardDraftRoutesDeps,
  projectId: ProjectId,
): Promise<string | null> => {
  const script = await deps.scripts.findByProject(projectId)
  if (script === null || script.currentVersionId === null) return null
  const version = await deps.scripts.findVersionById(script.currentVersionId)
  return version === null ? null : version.content
}

/**
 * 曲の構成。**解析済みの楽曲を先頭から探す。**
 * 1 件も解析されていなければ空配列を返す。解析が無いことは下書きを止める理由にならない。
 */
const projectSections = async (
  deps: StoryboardDraftRoutesDeps,
  projectId: ProjectId,
): Promise<readonly MusicSection[]> => {
  const tracks = await deps.musicTracks.findByProject(projectId)
  for (const track of tracks) {
    const analysis = await deps.musicAnalyses.findByTrack(track.id)
    if (analysis !== null) return analysis.sections
  }
  return []
}

/** Shot を下書きの入力へ写す。**並びは変えない**（既に決まっているため）。 */
const toDraftShot = (shot: Shot): StoryboardDraftShot => ({
  id: shot.id,
  code: shot.code,
  order: shot.order,
  startSec: shot.startSec,
  durationSec: shot.durationSec,
  description: shot.description,
  mood: shot.mood,
})

/** 例外を `StoryboardDraftRun.error` の形へ載せ替える。**握り潰さず必ず保存する。** */
const toRunError = (error: unknown, code: string): { code: string; message: string } => ({
  code,
  message: error instanceof Error ? error.message : String(error),
})

export const storyboardDraftRoutes = (deps: StoryboardDraftRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(createDraftRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if ((await deps.projects.findById(projectId)) === null) {
        return c.json(fail(NOT_FOUND_MESSAGE), 404)
      }

      /** 生きている Shot だけ（`findByProject` は論理削除を含まない）。 */
      const shots = await deps.shots.findByProject(projectId)
      if (shots.length === 0) {
        return c.json(fail(VALIDATION_ERROR_MESSAGE, { shots: [NO_SHOTS_MESSAGE] }), 422)
      }

      const [script, sections] = await Promise.all([
        currentScriptContent(deps, projectId),
        projectSections(deps, projectId),
      ])

      /**
       * **先に run を作る。** 走らせてから作ると、途中で落ちたときに
       * 「押したのに何も残らない」状態になり、失敗したことすら分からない。
       */
      const run = await deps.drafts.createRun({
        projectId,
        drafter: deps.drafter.name,
        status: 'running',
      })

      const failRun = async (error: { code: string; message: string }) => {
        const failed = await deps.drafts.updateRun(run.id, {
          status: 'failed',
          costUsd: 0,
          error,
        })
        return c.json(ok({ run: toStoryboardDraftRunResponse(failed), items: [] }), 201)
      }

      let outcome: StoryboardDraftOutcome
      try {
        outcome = await deps.drafter.draft({
          script,
          sections: [...sections],
          shots: shots.map(toDraftShot),
        })
      } catch (error) {
        // 握り潰さない。理由を run に書き残してから返す（CLAUDE.md 規約 5）。
        return await failRun(toRunError(error, 'drafter_threw'))
      }

      if (!outcome.ok) return await failRun(outcome.error)

      /**
       * 案の保存と run の完了。保存に失敗したら run も失敗にする。
       * `running` のまま残ると、画面には「実行中」と出続ける。
       */
      try {
        const items = await deps.drafts.addItems(run.id, outcome.items)
        const done = await deps.drafts.updateRun(run.id, {
          status: 'done',
          costUsd: outcome.costUsd,
          error: null,
        })
        return c.json(
          ok({
            run: toStoryboardDraftRunResponse(done),
            items: items.map(toStoryboardDraftItemResponse),
          }),
          201,
        )
      } catch (error) {
        return await failRun(toRunError(error, 'items_not_saved'))
      }
    })
    .openapi(adoptDraftRoute, async (c) => {
      const { projectId, runId } = c.req.valid('param')
      if ((await deps.projects.findById(projectId)) === null) {
        return c.json(fail(NOT_FOUND_MESSAGE), 404)
      }

      const run = await deps.drafts.findRunById(runId)
      if (run === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      /** 他 Project の run を経路に混ぜない（別の作品の案が紛れ込む）。 */
      if (run.projectId !== projectId) return c.json(fail(FOREIGN_RUN_MESSAGE), 404)
      if (run.status !== 'done') {
        return c.json(fail(VALIDATION_ERROR_MESSAGE, { runId: [RUN_NOT_DONE_MESSAGE] }), 422)
      }

      const { shotIds } = c.req.valid('json')
      const items = await deps.drafts.findItemsByRun(runId)
      const byShot = new Map(items.map((item) => [item.shotId, item] as const))

      /**
       * **1 件でも欠けていれば何も採用しない。**
       * 一部だけ通すと、押した人は全部通ったと思ったまま、通らなかった Shot に気付かない。
       */
      const withoutDraft = shotIds.filter((shotId) => !byShot.has(shotId))
      if (withoutDraft.length > 0) {
        return c.json(
          fail(VALIDATION_ERROR_MESSAGE, { shotIds: [noDraftForShotsMessage(withoutDraft)] }),
          422,
        )
      }

      const liveShots = await deps.shots.findByProject(projectId)
      const liveShotIds = new Set(liveShots.map((shot) => shot.id))
      const deleted = shotIds.filter((shotId) => !liveShotIds.has(shotId))
      if (deleted.length > 0) {
        return c.json(
          fail(VALIDATION_ERROR_MESSAGE, { shotIds: [missingShotsMessage(deleted)] }),
          422,
        )
      }

      const requested = shotIds.map((shotId) => byShot.get(shotId) as StoryboardDraftItem)
      /** 既に採用済みのものは触らない。**最初に人が決めた時刻を残す**（冪等）。 */
      const pending = requested.filter((item) => item.adoptedAt === null)

      /**
       * **Shot に書き込むのはここだけ。** 列挙された Shot の `description` / `mood` のみ。
       * 尺・並び・採用 Take は触らない。
       */
      for (const item of pending) {
        await deps.shots.update(item.shotId, { description: item.description, mood: item.mood })
      }
      const adopted = await deps.drafts.adoptItems(
        pending.map((item) => item.id),
        new Date(),
      )

      const adoptedByShot = new Map(adopted.map((item) => [item.shotId, item] as const))
      const resultItems = requested.map((item) => adoptedByShot.get(item.shotId) ?? item)

      // 更新後の Shot を読み直して返す。画面が「いまの説明」を描き直せるようにする。
      const updatedShots = await deps.shots.findByProject(projectId)
      const requestedShotIds = new Set(shotIds)

      return c.json(
        ok({
          adopted: resultItems.map(toStoryboardDraftItemResponse),
          shots: updatedShots
            .filter((shot) => requestedShotIds.has(shot.id))
            .map(toShotResponse),
        }),
        200,
      )
    })
