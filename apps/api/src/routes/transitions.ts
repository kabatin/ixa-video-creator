import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { EditRepositories, EditTransaction, ProjectRepository, ShotRepository, TransitionRepository } from '@ixa/db'
import {
  CreateTransitionInput as CreateTransitionInputSchema,
  ProjectId as ProjectIdSchema,
  Transition as TransitionSchema,
  TransitionId as TransitionIdSchema,
  newId,
  transitionSnapshotOf,
  type EditBatchTransitionEdit,
  type ProjectId,
  type Shot,
  type ShotId,
  type Transition,
  type TransitionType,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, VALIDATION_ERROR_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, listResponse, ok, okList, successResponse } from '../response.js'
import type { FieldErrors } from '../response.js'

/**
 * Transition（2 つの Shot をつなぐ 1 本の切り替え）の CRUD（DOMAIN.md §8 / ADR-0002）。
 * ADR-0006 に従い zod スキーマとハンドラを 1 ファイルに同居させる。
 *
 * **PATCH は持たない。** `TransitionRepository` に更新口が無く、
 * 「2 つの Shot の間に 1 本」という不変条件は
 * 差し替え（delete → create）のほうが保ちやすいため。差し替えは作成の本文に `replaceTransitionId` を付け、
 * 消すと置くを 1 つの取り消しの記録にまとめる（2026-10-19）。
 *
 * **置く・消す・差し替えは書く前に記録する**（`transition_edit`）。これまで記録が無く、消したら二度と戻らなかった。
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

/** 差し替える相手が無い・別の 2 つの Shot の間のもの。差し替えは同じ組の付け替えだけ。 */
export const REPLACE_TARGET_MESSAGE = '差し替えられるのは、同じ 2 つの Shot の間にあるトランジションだけです'

/**
 * projectId は経路が持つので本文には含めない。正が 2 つになるのを避ける。
 * `replaceTransitionId` を付けると、そのトランジションを消してから置く（差し替え。1 つの記録）。
 */
const CreateTransitionBody = CreateTransitionInputSchema.omit({ projectId: true })
  .extend({ replaceTransitionId: TransitionIdSchema.optional() })
  .openapi('CreateTransitionInput')

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
  /** 置く・消す・差し替えを、書く前に、書き込みと同じトランザクションで記録する（取り消し）。**省けない。** */
  transaction: EditTransaction
}

const summaryOf = (edits: readonly EditBatchTransitionEdit[]): string =>
  edits.length > 1 ? 'トランジションを差し替える' : edits[0]?.op === 'delete' ? 'トランジションを消す' : 'トランジションを置く'

const recordTransitionEdits = async (
  recorder: EditRepositories['editBatches'],
  projectId: ProjectId,
  transitionEdits: readonly EditBatchTransitionEdit[],
): Promise<void> => {
  await recorder.create({ projectId, kind: 'transition_edit', summary: summaryOf(transitionEdits), entries: [], transitionEdits: [...transitionEdits] })
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

/** 置けるか（置く口と、消したものを置き直す取り消しの両方が使う。規則を 2 か所に書かない）。通れば正規化した尺を返す。 */
export const checkPlacement = async (
  deps: { readonly shots: Pick<ShotRepository, 'findById'> },
  projectId: ProjectId,
  input: { readonly fromShotId: ShotId; readonly toShotId: ShotId; readonly type: TransitionType; readonly durationSec: number },
  existing: readonly Transition[],
): Promise<{ readonly ok: true; readonly durationSec: number } | { readonly ok: false; readonly fields: FieldErrors }> => {
  /** 自分自身への遷移。先に見るのは、Shot を 1 つしか引かずに判る誤りだから。 */
  if (input.fromShotId === input.toShotId) {
    return { ok: false, fields: { toShotId: [SELF_TRANSITION_MESSAGE] } }
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
    return {
      ok: false,
      fields: {
        ...(belongs(fromShot) ? {} : { fromShotId: [FOREIGN_SHOT_MESSAGE] }),
        ...(belongs(toShot) ? {} : { toShotId: [FOREIGN_SHOT_MESSAGE] }),
      },
    }
  }

  /**
   * 同じ (from, to) の重複。`TransitionRepository` は
   * 「(fromShotId, toShotId) に対して一意」を前提に更新口を持たないので、
   * 2 本目を通すとどちらが有効か決まらなくなる。
   * 同じ組の重複は、出入りの重複より具体的なので先に見る。
   */
  const duplicated = existing.some(
    (t) => t.fromShotId === input.fromShotId && t.toShotId === input.toShotId,
  )
  if (duplicated) {
    return { ok: false, fields: { toShotId: [DUPLICATE_TRANSITION_MESSAGE] } }
  }

  if (existing.some((t) => t.fromShotId === input.fromShotId)) {
    return { ok: false, fields: { fromShotId: [EXISTING_OUTGOING_MESSAGE] } }
  }

  if (existing.some((t) => t.toShotId === input.toShotId)) {
    return { ok: false, fields: { toShotId: [EXISTING_INCOMING_MESSAGE] } }
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
    return { ok: false, fields: { durationSec: [transitionTooLongMessage(shortestSec)] } }
  }

  return { ok: true, durationSec }
}

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

      const { replaceTransitionId, ...input } = c.req.valid('json')
      const all = await deps.transitions.findByProject(projectId)
      const replaced = replaceTransitionId === undefined ? undefined : all.find((t) => t.id === replaceTransitionId)
      if (
        replaceTransitionId !== undefined &&
        (replaced === undefined || replaced.fromShotId !== input.fromShotId || replaced.toShotId !== input.toShotId)
      ) {
        return c.json(fail(VALIDATION_ERROR_MESSAGE, { replaceTransitionId: [REPLACE_TARGET_MESSAGE] }), 422)
      }

      // 差し替える相手は消してから置くので、重なりの検査から外す。
      const placement = await checkPlacement(deps, projectId, input, all.filter((t) => t.id !== replaceTransitionId))
      if (!placement.ok) return c.json(fail(VALIDATION_ERROR_MESSAGE, placement.fields), 422)

      // 記録・消す・置くを 1 つのトランザクションで（差し替えの途中で落ちても、前のトランジションが消えたままにならない）。
      const id = newId(TransitionIdSchema)
      const created = await deps.transaction(async (tx) => {
        await recordTransitionEdits(tx.editBatches, projectId, [
          ...(replaced === undefined ? [] : [{ op: 'delete' as const, transitionId: replaced.id, before: transitionSnapshotOf(replaced) }]),
          { op: 'create', transitionId: id },
        ])
        if (replaced !== undefined) await tx.transitions.delete(replaced.id)
        return tx.transitions.create({ ...input, projectId, durationSec: placement.durationSec, id })
      })
      return c.json(ok(created), 201)
    })
    .openapi(deleteTransitionRoute, async (c) => {
      /**
       * 存在しなければリポジトリが DbNotFoundError を投げ、共通ハンドラが 404 にする。
       * ここで catch しないのは意図的で、畳んでよい既知の失敗が他に無いため。
       * 例外を丸ごと捕まえると DB 障害まで「見つからない」として返してしまう。
       */
      const { id } = c.req.valid('param')
      const existing = await deps.transitions.findById(id)
      if (existing === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      await deps.transaction(async (tx) => {
        await recordTransitionEdits(tx.editBatches, existing.projectId, [
          { op: 'delete', transitionId: id, before: transitionSnapshotOf(existing) },
        ])
        await tx.transitions.delete(id)
      })
      return c.body(null, 204)
    })
}
