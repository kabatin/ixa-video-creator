import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { ProjectRepository, ShotRepository, TransitionRepository } from '@ixa/db'
import {
  CreateTransitionInput as CreateTransitionInputSchema,
  ProjectId as ProjectIdSchema,
  Transition as TransitionSchema,
  TransitionId as TransitionIdSchema,
  type ProjectId,
  type Shot,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, VALIDATION_ERROR_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, listResponse, ok, okList, successResponse } from '../response.js'

/**
 * Transition（2 つの Shot をつなぐ 1 本の切り替え）の CRUD（DOMAIN.md §8 / ADR-0002）。
 * ADR-0006 に従い zod スキーマとハンドラを 1 ファイルに同居させる。
 *
 * **PATCH は持たない。** `TransitionRepository` に更新口が無く、
 * 「2 つの Shot の間に 1 本」という不変条件は
 * 差し替え（delete → create）のほうが保ちやすいため。
 */

/** 実在しない Shot と、他 Project の Shot はどちらも「この経路では繋げない」ので同じ扱いにする。 */
export const FOREIGN_SHOT_MESSAGE = 'この Project に属する Shot ではありません'
export const SELF_TRANSITION_MESSAGE = '同じ Shot 同士は繋げません'
export const DUPLICATE_TRANSITION_MESSAGE =
  'この 2 つの Shot の間にはすでに Transition があります。付け替えるには先に削除してください'
/**
 * Transition は隣り合う Shot をつなぐので、1 つの Shot が持てるのは
 * **出ていく 1 本と入ってくる 1 本だけ**。
 *
 * ここで弾かないと、レンダラが最初の 1 本しか採らないため
 * （`packages/render/src/plan.ts` の `findOutgoing`）、2 本目は絵に出ない。
 * レンダリング前の検査は隣接していない Transition を error にするので
 * 最終的には止まるが、**作った時点では 201 が返る**。
 * 気づくのがレンダリングまで遅れると、原因が Transition だと分かりにくい。
 */
export const EXISTING_OUTGOING_MESSAGE =
  'この Shot からは既に別の Shot へ Transition が出ています。Shot がつながる先は 1 つだけです'
export const EXISTING_INCOMING_MESSAGE =
  'この Shot には既に別の Shot から Transition が入っています。Shot につながる元は 1 つだけです'
export const TRANSITION_TOO_LONG_MESSAGE =
  'Transition の尺が、つなぐ Shot の尺を超えています'

/**
 * 超過メッセージに実際の上限を添える。
 * 何秒までなら通るのかが分からないと、利用者は当てずっぽうで再送するしかない。
 */
export const transitionTooLongMessage = (shortestSec: number): string =>
  `${TRANSITION_TOO_LONG_MESSAGE}（つなげる上限は ${shortestSec.toFixed(3)} 秒）`

/**
 * 浮動小数の比較に使う許容誤差。`@ixa/timeline` の `TIME_EPSILON` と同じ値。
 * あちらは index から公開されていないため import せず、同じ値をここに置く。
 * ここを緩めるとレンダリング前の検査（`validateTimeline`）とずれるので変えない。
 */
const TIME_EPSILON = 1e-6

export const TransitionResponse = TransitionSchema.openapi('Transition')

/** projectId は経路が持つので本文には含めない。正が 2 つになるのを避ける。 */
const CreateTransitionBody = CreateTransitionInputSchema.omit({ projectId: true }).openapi(
  'CreateTransitionInput',
)

const ProjectParams = z.object({
  projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }),
})
const TransitionParams = z.object({
  id: TransitionIdSchema.openapi({ param: { name: 'id', in: 'path' } }),
})

const jsonContent = <T extends z.ZodTypeAny>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
})

const body = <T extends z.ZodTypeAny>(schema: T) => ({
  required: true as const,
  content: { 'application/json': { schema } },
})

const commonErrors = {
  404: errorContent('対象が存在しない'),
  422: errorContent('入力の検証に失敗した'),
  500: errorContent('サーバ内部エラー'),
}

const listTransitionsRoute = createRoute({
  method: 'get', path: '/projects/{projectId}/transitions', tags: ['transitions'],
  summary: 'Project の Transition 一覧（投入順）',
  request: { params: ProjectParams },
  responses: {
    200: jsonContent('Transition 一覧', listResponse(TransitionResponse)),
    ...commonErrors,
  },
})

const createTransitionRoute = createRoute({
  method: 'post', path: '/projects/{projectId}/transitions', tags: ['transitions'],
  summary: 'Transition を作成する',
  request: { params: ProjectParams, body: body(CreateTransitionBody) },
  responses: {
    201: jsonContent('作成された Transition', successResponse(TransitionResponse)),
    ...commonErrors,
  },
})

const deleteTransitionRoute = createRoute({
  method: 'delete', path: '/transitions/{id}', tags: ['transitions'],
  summary: 'Transition を削除する',
  request: { params: TransitionParams },
  responses: { 204: { description: '削除した（本文なし）' }, ...commonErrors },
})

export type TransitionRoutesDeps = {
  transitions: TransitionRepository
  /** つなぐ 2 つの Shot の実在・所属・尺を見るために使う。 */
  shots: ShotRepository
  /** Project の実在確認だけに使う。 */
  projects: ProjectRepository
}

/**
 * `cut` は瞬間の切り替えなので尺を持たない。
 *
 * **判断: 非ゼロで来ても 422 にせず 0 に正規化し、応答でその 0 を返す。**
 * 理由は 3 つある。
 * 1. レンダラは `cut` の `durationSec` を一切見ない（`packages/render/src/plan.ts` の
 *    `isDissolve` は type と duration の両方を見る）。保存した値は絵に出ない。
 * 2. 0 以外を保存すると、レンダリング前の検査（`validateTimeline` の
 *    `transition_too_long`）が**絵に影響しない値**を理由にレンダリングを止めうる。
 * 3. 画面側は尺の入力欄を持ったまま種別だけ `cut` に切り替えるのが自然な操作で、
 *    そこで 422 を返すのは操作の誤りではなく入力欄の作りへの罰になる。
 *
 * 正規化した事実は**黙って消えない**。201 の本文に `durationSec: 0` がそのまま載るので、
 * 呼び出し側は自分が送った値が採用されなかったことを応答で確認できる。
 */
const normalizeDurationSec = (type: z.infer<typeof TransitionSchema>['type'], durationSec: number) =>
  type === 'cut' ? 0 : durationSec

export const transitionRoutes = (deps: TransitionRoutesDeps) => {
  const projectMissing = async (projectId: ProjectId): Promise<boolean> =>
    (await deps.projects.findById(projectId)) === null

  return new OpenAPIHono({ defaultHook: validationHook })
    .openapi(listTransitionsRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      /**
       * 存在しない Project で 200 + 空配列を返さない。
       * 「1 本も繋がっていない」と「そんな Project は無い」は別の事実で、
       * 空配列にすると呼び出し側で前者に化ける。
       */
      if (await projectMissing(projectId)) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      return c.json(okList(await deps.transitions.findByProject(projectId)), 200)
    })
    .openapi(createTransitionRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if (await projectMissing(projectId)) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      const input = c.req.valid('json')

      /** 自分自身への遷移。先に見るのは、Shot を 1 つしか引かずに判る誤りだから。 */
      if (input.fromShotId === input.toShotId) {
        return c.json(fail(VALIDATION_ERROR_MESSAGE, { toShotId: [SELF_TRANSITION_MESSAGE] }), 422)
      }

      const [fromShot, toShot] = await Promise.all([
        deps.shots.findById(input.fromShotId),
        deps.shots.findById(input.toShotId),
      ])

      /**
       * 他 Project の Shot を繋ぐと、**別の作品のカット**がこの Project の
       * タイムラインに現れる。経路の Project と突き合わせて弾く。
       */
      const belongs = (shot: Shot | null): shot is Shot =>
        shot !== null && shot.projectId === projectId

      if (!belongs(fromShot) || !belongs(toShot)) {
        // 片方だけでなく両方まとめて返す。1 往復ごとに 1 件では直しづらい。
        return c.json(
          fail(VALIDATION_ERROR_MESSAGE, {
            ...(belongs(fromShot) ? {} : { fromShotId: [FOREIGN_SHOT_MESSAGE] }),
            ...(belongs(toShot) ? {} : { toShotId: [FOREIGN_SHOT_MESSAGE] }),
          }),
          422,
        )
      }

      /**
       * 同じ (from, to) の重複。`TransitionRepository` は
       * 「(fromShotId, toShotId) に対して一意」を前提に更新口を持たないので、
       * 2 本目を通すとどちらが有効か決まらなくなる。
       */
      const existing = await deps.transitions.findByProject(projectId)

      // 同じ組の重複は、出入りの重複より具体的なので先に見る。
      const duplicated = existing.some(
        (t) => t.fromShotId === input.fromShotId && t.toShotId === input.toShotId,
      )
      if (duplicated) {
        return c.json(
          fail(VALIDATION_ERROR_MESSAGE, { toShotId: [DUPLICATE_TRANSITION_MESSAGE] }),
          422,
        )
      }

      if (existing.some((t) => t.fromShotId === input.fromShotId)) {
        return c.json(
          fail(VALIDATION_ERROR_MESSAGE, { fromShotId: [EXISTING_OUTGOING_MESSAGE] }),
          422,
        )
      }

      if (existing.some((t) => t.toShotId === input.toShotId)) {
        return c.json(
          fail(VALIDATION_ERROR_MESSAGE, { toShotId: [EXISTING_INCOMING_MESSAGE] }),
          422,
        )
      }

      const durationSec = normalizeDurationSec(input.type, input.durationSec)

      /**
       * つなぐ 2 つの Shot のどちらよりも長い Transition は作らせない。
       * のりしろは接する Shot の尺から取るので、超えると素材が足りず
       * タイムラインが壊れる（`validateTimeline` の `transition_too_long` と同じ規則）。
       *
       * `cut` は上で 0 に正規化済みなので、この検査には決して掛からない。
       */
      const shortestSec = Math.min(fromShot.durationSec, toShot.durationSec)
      if (durationSec > shortestSec + TIME_EPSILON) {
        return c.json(
          fail(VALIDATION_ERROR_MESSAGE, { durationSec: [transitionTooLongMessage(shortestSec)] }),
          422,
        )
      }

      const created = await deps.transitions.create({ ...input, projectId, durationSec })
      return c.json(ok(created), 201)
    })
    .openapi(deleteTransitionRoute, async (c) => {
      /**
       * 存在しなければリポジトリが DbNotFoundError を投げ、共通ハンドラが 404 にする。
       * ここで catch しないのは意図的で、畳んでよい既知の失敗が他に無いため。
       * 例外を丸ごと捕まえると DB 障害まで「見つからない」として返してしまう。
       */
      await deps.transitions.delete(c.req.valid('param').id)
      return c.body(null, 204)
    })
}
