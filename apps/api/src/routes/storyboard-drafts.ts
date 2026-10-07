import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type {
  MusicAnalysisRepository,
  MusicTrackRepository,
  NarrationLineRepository,
  ProjectRepository,
  ScriptRepository,
  ShotRepository,
  StoryboardDraftRepository,
} from '@ixa/db'
import {
  ProjectId as ProjectIdSchema,
  ShotId as ShotIdSchema,
  StoryboardDraftItem as StoryboardDraftItemSchema,
  StoryboardDraftRun as StoryboardDraftRunSchema,
  StoryboardDraftRunId as StoryboardDraftRunIdSchema,
  lyricLines,
  lyricsDuring,
  mergeShotCamera,
  narrationDuring,
  type MusicSection,
  type NarrationLine,
  type Project,
  type ProjectId,
  type Shot,
  type ShotCamera,
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
import {
  editBatchEntry,
  recordEditBatch,
  shotBeforePatch,
  type EditBatchRecorder,
} from './edit-batch-recording.js'
import { ShotResponse, toShotResponse } from './shots.js'
import {
  castOf,
  loadStoryboardDraftCast,
  type StoryboardDraftCast,
  type StoryboardDraftCastDeps,
} from './storyboard-draft-cast.js'

/**
 * 絵コンテの一括下書きと、その採否（PHASE 6.3 / P63-4）。
 * ADR-0006 に従い zod スキーマとハンドラを 1 ファイルに同居させる。
 *
 * **下書きは Shot を書き換えない。** 案は `storyboard_draft_items` に溜め、
 * 人が Shot ごとに採否を決める。**Shot に書き込むのは採用の口だけ。**
 * 本制作の Shot の一部は既に Take を採用済みで、説明が黙って書き換わると
 * 生成済みの Take と食い違ったまま誰も気付かない（制作者の判断 2026-09-18）。
 *
 * Shot を作る口（`storyboard.ts`）とは別のファイル・別の factory にしてある。
 * deps が重ならず、片方だけを組んでテストできる（`reviews.ts` と同じく `Pick` で絞る）。
 */

const ProjectParams = z.object({
  projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }),
})

const jsonContent = <T extends z.ZodTypeAny>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
})

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

/**
 * 最新の下書き 1 件。**画面を開き直しても案が残るための口。**
 *
 * 27 件ぶんを LLM に投げて数分待った結果が、再読み込みで消えるなら保存している意味が無い。
 *
 * **3 つの状態を区別できる形にしてある。**
 * - `run === null` — まだ一度も下書きしていない
 * - `run.status === 'running'` — 途中で落ちた可能性がある（プロセスが死ぬと永久に残る）
 * - `run.status === 'done' | 'failed'` — 終わっている
 *
 * **区別のための列を別に持たない。** `status` から読めるものを 2 つ持つと必ずズレる
 * （`isAdopted` が真偽値の列を持たないのと同じ理由）。
 * `running` を「実行中」と見せ続けると待てば終わると誤解させるので、
 * **いつ始まったかは `run.createdAt` で必ず渡す**（L-015）。判断は画面が行う。
 */
const StoryboardDraftLatest = z
  .object({
    run: StoryboardDraftRunResponse.nullable(),
    /** `run` が `done` 以外なら空。**`run.status` を見ずに「案なし」と読まないこと。** */
    items: z.array(StoryboardDraftItemResponse),
  })
  .openapi('StoryboardDraftLatest')

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

const latestDraftRoute = createRoute({
  method: 'get', path: '/projects/{projectId}/storyboard/drafts', tags: ['storyboard'],
  summary: '最新の下書きと、その案を読む',
  request: { params: ProjectParams },
  responses: {
    200: jsonContent('最新の下書き（無ければ run は null）', successResponse(StoryboardDraftLatest)),
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

export type StoryboardDraftRoutesDeps = StoryboardDraftCastDeps & {
  projects: Pick<ProjectRepository, 'findById'>
  /** ナレーションの行（ADR-0038）。Shot ごとに、その間に話される言葉を渡す。ナレーションが無い環境では省く。 */
  narrationLines?: Pick<NarrationLineRepository, 'findByProject'>
  /** 採用のときだけ `update` を使う。**下書きの作成では書かない。** */
  shots: Pick<ShotRepository, 'findByProject' | 'update'>
  scripts: Pick<ScriptRepository, 'findByProject' | 'findVersionById'>
  musicTracks: Pick<MusicTrackRepository, 'findByProject'>
  musicAnalyses: Pick<MusicAnalysisRepository, 'findByTrack'>
  drafts: Pick<
    StoryboardDraftRepository,
    | 'createRun'
    | 'updateRun'
    | 'addItems'
    | 'findRunById'
    | 'findLatestRunByProject'
    | 'findItemsByRun'
    | 'adoptItems'
  >
  /** いま選んでいるテキストの AI。**押すたびに呼ぶ**（画面で選び直したら次から効く。ADR-0032）。 */
  drafter: () => Promise<StoryboardDrafter>
  /**
   * 採用の**直前**に「変える前」を残す口（P64-1）。
   * 27 件が一度に書き換わる操作なので、記録が無いと戻せない。
   */
  editBatches: EditBatchRecorder
}

/**
 * 採用で Shot に当てる値。**説明・雰囲気・カメラだけ。** 尺・並び・採用 Take は触らない。
 *
 * カメラは**案に入っている項目だけを重ねる**（ADR-0043。`mergeShotCamera`）。
 * 全体を置き換えると、案が触れていない項目（人が決めた高さやレンズ）が消える。
 * 案がカメラを出していなければ、カメラの欄ごと渡さない（「触らない」をそのまま表す）。
 */
const adoptPatch = (
  shot: Shot,
  item: Pick<StoryboardDraftItem, 'description' | 'mood' | 'camera'>,
): { description: string; mood: string | null; camera?: ShotCamera } => ({
  description: item.description,
  mood: item.mood,
  ...(item.camera === null ? {} : { camera: mergeShotCamera(shot.camera, item.camera) }),
})

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

/**
 * Shot を下書きの入力へ写す。**並びは変えない**（既に決まっているため）。
 * その Shot の間に歌い出す歌詞（ADR-0033。規則は domain の `lyricsDuring`）と、出る登場人物・ロケーションも添える。
 */
const toDraftShot =
  (
    project: Pick<Project, 'lyrics' | 'lyricCues'>,
    cast: StoryboardDraftCast,
    narration: readonly Pick<NarrationLine, 'text' | 'startSec'>[],
  ) =>
  (shot: Shot): StoryboardDraftShot => {
    const shotCast = castOf(cast, shot.id)
    return {
      id: shot.id,
      code: shot.code,
      order: shot.order,
      startSec: shot.startSec,
      durationSec: shot.durationSec,
      description: shot.description,
      mood: shot.mood,
      lyrics: [...lyricsDuring(lyricLines(project.lyrics), project.lyricCues, shot)],
      // その Shot の間に話されるナレーション（ADR-0038。規則は domain の `narrationDuring`）。
      narration: [...narrationDuring(narration, shot)],
      cast: [...shotCast.cast],
      location: shotCast.location,
    }
  }

/** 例外を `StoryboardDraftRun.error` の形へ載せ替える。**握り潰さず必ず保存する。** */
const toRunError = (error: unknown, code: string): { code: string; message: string } => ({
  code,
  message: error instanceof Error ? error.message : String(error),
})

export const storyboardDraftRoutes = (deps: StoryboardDraftRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(latestDraftRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if ((await deps.projects.findById(projectId)) === null) {
        return c.json(fail(NOT_FOUND_MESSAGE), 404)
      }

      const run = await deps.drafts.findLatestRunByProject(projectId)
      if (run === null) {
        // まだ一度も下書きしていない。**「案 0 件」ではない**ので run を null で返す。
        return c.json(ok({ run: null, items: [] }), 200)
      }

      /**
       * 終わっていない run の案は返さない。
       * `running` の途中で入った案を並べると、**全部揃っているように見えてしまう。**
       * 何件揃うはずだったかは、終わるまで分からない。
       */
      const items = run.status === 'done' ? await deps.drafts.findItemsByRun(run.id) : []

      return c.json(
        ok({
          run: toStoryboardDraftRunResponse(run),
          items: items.map(toStoryboardDraftItemResponse),
        }),
        200,
      )
    })
    .openapi(createDraftRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      const project = await deps.projects.findById(projectId)
      if (project === null) {
        return c.json(fail(NOT_FOUND_MESSAGE), 404)
      }

      /** 生きている Shot だけ（`findByProject` は論理削除を含まない）。 */
      const shots = await deps.shots.findByProject(projectId)
      if (shots.length === 0) {
        return c.json(fail(VALIDATION_ERROR_MESSAGE, { shots: [NO_SHOTS_MESSAGE] }), 422)
      }

      const [script, sections, cast] = await Promise.all([
        currentScriptContent(deps, projectId),
        projectSections(deps, projectId),
        loadStoryboardDraftCast(deps, projectId, shots),
      ])

      /**
       * **先に run を作る。** 走らせてから作ると、途中で落ちたときに
       * 「押したのに何も残らない」状態になり、失敗したことすら分からない。
       */
      const drafter = await deps.drafter()
      const run = await deps.drafts.createRun({
        projectId,
        drafter: drafter.name,
        status: 'running',
      })

      const failRun = async (
        error: { code: string; message: string },
        costUsd: number,
      ) => {
        const failed = await deps.drafts.updateRun(run.id, {
          status: 'failed',
          // 額を 0 に畳まない。失敗しても払った分は払っている。
          costUsd,
          error,
        })
        return c.json(ok({ run: toStoryboardDraftRunResponse(failed), items: [] }), 201)
      }

      const narration = (await deps.narrationLines?.findByProject(project.id)) ?? []
      let outcome: StoryboardDraftOutcome
      try {
        outcome = await drafter.draft({
          script,
          sections: [...sections],
          shots: shots.map(toDraftShot(project, cast, narration)),
          // 作品の方針（ADR-0030）。案が作品のルックに合い、避けたいものを描かないように。
          look: project.styleGuide,
          avoid: project.avoid,
          // 歌詞（ADR-0033）。時刻をまだ合わせていない行も、全文で渡す。
          lyrics: project.lyrics,
          // 登場人物とロケーション。見た目を作らせないため、書いてあることだけを渡す（storyboard-draft-cast.ts）。
          characters: [...cast.characters],
          locations: [...cast.locations],
        })
      } catch (error) {
        // 握り潰さない。理由を run に書き残してから返す（CLAUDE.md 規約 5）。
        // 例外で戻ってきた場合だけは、いくら払ったか知る術が無い。
        return await failRun(toRunError(error, 'drafter_threw'), 0)
      }

      if (!outcome.ok) return await failRun(outcome.error, outcome.costUsd)

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
        return await failRun(toRunError(error, 'items_not_saved'), outcome.costUsd)
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
       *
       * **ここと `adoptItems` は 1 トランザクションではない**（Architect の判断 2026-09-18）。
       * 途中で落ちると Shot は変わったのに採用の印だけが付かない。
       * それでも分けてあるのは、**押し直せば同じ説明が書かれて印も付く**（自己修復する）ため。
       * 跨ぐリポジトリが 2 つあり、トランザクションの口を設計する方が大きい。
       * 案の中身は追記のみで変わらないので、押し直しても書かれる内容は同じになる。
       */
      /**
       * **書く直前に、変える欄の現在値を残す**（P64-1）。
       * 同じ文字を採用し直しただけの Shot は記録に入れない（`shotBeforePatch` が空を返す）。
       * 入れると履歴が「何も戻らない行」で埋まり、本当に戻したい操作が埋もれる。
       */
      const liveShotById = new Map(liveShots.map((shot) => [shot.id, shot] as const))
      await recordEditBatch(deps.editBatches, {
        projectId,
        kind: 'draft_adopt',
        summarize: (count) => `絵コンテの案を ${count.toString()} 件採用しました`,
        entries: pending.flatMap((item) => {
          const shot = liveShotById.get(item.shotId)
          if (shot === undefined) return []
          const before = shotBeforePatch(shot, adoptPatch(shot, item))
          return [editBatchEntry(item.shotId, before)]
        }),
      })

      for (const item of pending) {
        const shot = liveShotById.get(item.shotId)
        if (shot === undefined) continue
        await deps.shots.update(item.shotId, adoptPatch(shot, item))
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
