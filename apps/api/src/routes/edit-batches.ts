import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  EditBatchId as EditBatchIdSchema,
  EditBatchKind as EditBatchKindSchema,
  ProjectId as ProjectIdSchema,
  ShotId as ShotIdSchema,
  TimelineClipId as TimelineClipIdSchema,
  canUndo,
  isUndone,
  undoTouchesSelectedTake,
  undoTouchesStatus,
  type EditBatch,
  type EditBatchClipEntry,
  type EditBatchEntry,
  type ProjectId,
  type ShotId,
  type TimelineClip,
  type TimelineClipId,
} from '@ixa/domain'
import type { EditBatchRepository, ProjectRepository, ShotRepository, TimelineClipRepository } from '@ixa/db'
import { roughCutLockedReason } from '@ixa/timeline'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, ok, okList, successResponse, listResponse } from '../response.js'
import { FOREIGN_SHOT_REASON, SHOT_NOT_FOUND_REASON } from './shots-bulk.js'

/**
 * 一括で変えた操作の履歴と、その取り消し（P64-1 / 横断 ROADMAP: Undo と履歴）。
 *
 * ```
 * GET  /projects/{projectId}/edit-batches            履歴（直近が先頭）
 * POST /projects/{projectId}/edit-batches/{id}/undo  取り消す
 * ```
 *
 * ★ **当てられなかったものは黙って飛ばさない。** Shot が消えていた・他 Project の
 *   ものだった、はすべて**理由つきで返す**（lessons L-013 / L-015）。
 *   1 件の失敗で残りを止めもしない。件数だけに畳むと、人は何が戻っていないのか
 *   探しに行けなくなる。
 *
 * ★ **二度取り消さない。** 印を付けるのは `markUndone` の 1 箇所で、
 *   既に取り消し済みなら `null` が返る。もう一度当てると、その後に人が直した
 *   内容を古い値で塗り潰す。
 */

export const ALREADY_UNDONE_MESSAGE = '既に取り消されています'
export const NOTHING_TO_UNDO_MESSAGE = '取り消す内容がありません'
export const FOREIGN_BATCH_MESSAGE = 'この Project の記録ではありません'

const ProjectParams = z.object({
  projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }),
})

const BatchParams = ProjectParams.extend({
  id: EditBatchIdSchema.openapi({ param: { name: 'id', in: 'path' } }),
})

/**
 * 履歴 1 行。
 *
 * **中身（変える前の値）は画面へ出さない。** 画面が要るのは「いつ・何を・何件」だけで、
 * 200 件ぶんの旧値を毎回運ぶ理由が無い。日時は ISO 文字列で渡す
 * （`Date` をそのまま載せると受け手ごとに解釈がぶれる）。
 */
export const EditBatchSummaryResponse = z
  .object({
    id: EditBatchIdSchema,
    kind: EditBatchKindSchema,
    summary: z.string().min(1),
    /** 変える前を記録した Shot の件数。 */
    shotCount: z.number().int().nonnegative(),
    /** 変える前を記録したテロップの件数（テロップの見た目のまとめ変更）。 */
    clipCount: z.number().int().nonnegative(),
    /** **`null` は「まだ取り消していない」**（「取り消せない」ではない）。 */
    undoneAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    /** 取り消せるか。判定はサーバが持ち、画面は結果だけを見る（lessons L-016）。 */
    canUndo: z.boolean(),
  })
  .openapi('EditBatchSummary')
export type EditBatchSummaryResponse = z.infer<typeof EditBatchSummaryResponse>

const UndoFailure = z
  .object({ shotId: ShotIdSchema, reason: z.string().min(1) })
  .openapi('EditBatchUndoFailure')

const UndoClipFailure = z
  .object({ clipId: TimelineClipIdSchema, reason: z.string().min(1) })
  .openapi('EditBatchUndoClipFailure')

/** **戻せた分と戻せなかった分を両方返す。** 件数だけでは何が残ったか分からない。 */
export const UndoEditBatchResponse = z
  .object({
    batch: EditBatchSummaryResponse,
    restored: z.array(ShotIdSchema),
    failed: z.array(UndoFailure),
    /** 戻したテロップ。Shot の記録だけなら空。 */
    restoredClips: z.array(TimelineClipIdSchema),
    failedClips: z.array(UndoClipFailure),
  })
  .openapi('UndoEditBatchResult')
export type UndoEditBatchResponse = z.infer<typeof UndoEditBatchResponse>

export const toEditBatchSummary = (batch: EditBatch): EditBatchSummaryResponse => ({
  id: batch.id,
  kind: batch.kind,
  summary: batch.summary,
  shotCount: batch.entries.length,
  clipCount: batch.clipEntries.length,
  undoneAt: batch.undoneAt === null ? null : batch.undoneAt.toISOString(),
  createdAt: batch.createdAt.toISOString(),
  canUndo: canUndo(batch),
})

const listRoute = createRoute({
  method: 'get',
  path: '/projects/{projectId}/edit-batches',
  tags: ['edit-batches'],
  summary: '一括で変えた操作の履歴（直近が先頭）',
  request: { params: ProjectParams },
  responses: {
    200: {
      description: '履歴',
      content: { 'application/json': { schema: listResponse(EditBatchSummaryResponse) } },
    },
    404: errorContent('Project が存在しない'),
    500: errorContent('サーバ内部エラー'),
  },
})

const undoRoute = createRoute({
  method: 'post',
  path: '/projects/{projectId}/edit-batches/{id}/undo',
  tags: ['edit-batches'],
  summary: '一括で変えた操作を取り消す（戻せなかったものは理由つきで返す）',
  request: { params: BatchParams },
  responses: {
    200: {
      description: '戻せた分と、戻せなかった分',
      content: { 'application/json': { schema: successResponse(UndoEditBatchResponse) } },
    },
    404: errorContent('Project / 記録が存在しない'),
    409: errorContent('既に取り消し済み / 今は取り消せない'),
    422: errorContent('入力の検証に失敗した'),
    500: errorContent('サーバ内部エラー'),
  },
})

export type EditBatchRoutesDeps = {
  projects: Pick<ProjectRepository, 'findById'>
  /**
   * 戻すのは `update` / `selectTake` / `updateStatus` の 3 つだけ。Take の作成には触らない。
   * 一括採用は採用 Take と状態の両方を動かすので、状態を戻す口も要る。
   */
  shots: Pick<ShotRepository, 'findById' | 'selectTake' | 'update' | 'updateStatus'>
  editBatches: Pick<EditBatchRepository, 'findByProject' | 'findById' | 'markUndone'>
  /** テロップの見た目を戻す（`clipEntries`）。文字・時間には触らない。 */
  timelineClips: Pick<TimelineClipRepository, 'findByProject' | 'update'>
}

/** 戻すテロップが無い（消された）。 */
export const CLIP_NOT_FOUND_REASON = 'テロップが見つかりません（消された可能性があります）'
export const NOT_TEXT_CLIP_REASON = 'テロップではなくなっています'

/**
 * テロップ 1 件の見た目を変える前へ戻す。**見た目と styleId だけ**を書き戻し、文字・印（歌詞の行）は残す。
 * 前に見た目が無かった（`null`）なら外す。戻せなければ理由を返す（握り潰さない）。
 */
const restoreClipEntry = async (
  deps: Pick<EditBatchRoutesDeps, 'timelineClips'>,
  clips: ReadonlyMap<TimelineClipId, TimelineClip>,
  entry: EditBatchClipEntry,
): Promise<string | null> => {
  const clip = clips.get(entry.clipId)
  if (clip === undefined) return CLIP_NOT_FOUND_REASON
  if (clip.content.type !== 'text') return NOT_TEXT_CLIP_REASON
  try {
    // いまの見た目を外してから、変える前を書く（無かったなら外したまま）。
    const rest = Object.fromEntries(Object.entries(clip.content.params).filter(([key]) => key !== 'style'))
    const params =
      entry.style === null
        ? { ...rest, styleId: entry.styleId }
        : { ...rest, style: entry.style, styleId: entry.styleId }
    await deps.timelineClips.update(clip.id, { content: { ...clip.content, params } })
    return null
  } catch (cause) {
    return `戻せませんでした: ${cause instanceof Error ? cause.message : String(cause)}`
  }
}

/**
 * ロックを尊重するか。
 *
 * **その操作が行きで見ていたものだけを、帰りでも見る。** 粗編集はロック済み Shot を
 * 当てないので（`timeline.ts` の `applyChange`）、戻すときも当てない。
 * 絵コンテの採用と一括変更はロックを見ないので、帰りでも見ない。
 * 片方だけ厳しくすると、行きで書けたものが帰りで戻せなくなる。
 */
const respectsLock = (batch: EditBatch): boolean => batch.kind === 'rough_cut'

/** 記録 1 件ぶんを Shot へ当て直す。当てなかった / 当てられなかったときは理由を返す。 */
const restoreEntry = async (
  deps: Pick<EditBatchRoutesDeps, 'shots'>,
  projectId: ProjectId,
  batch: EditBatch,
  entry: EditBatchEntry,
): Promise<string | null> => {
  try {
    // **読みも try の中に置く。** ここで落ちると、印だけ付いて 500 になり、
    // どの Shot が戻らなかったのかが画面から消える。
    const shot = await deps.shots.findById(entry.shotId)
    if (shot === null) return SHOT_NOT_FOUND_REASON
    if (shot.projectId !== projectId) return FOREIGN_SHOT_REASON
    if (respectsLock(batch) && shot.lockedAt !== null) return roughCutLockedReason(shot.code)

    if (Object.keys(entry.patch).length > 0) {
      await deps.shots.update(entry.shotId, entry.patch)
    }
    /**
     * **欄が無ければ触っていないので戻さない。** `null` は「採用していなかった」なので、
     * 採用を外す方向へ戻す（`selectTake` は `null` を受ける）。
     */
    if (undoTouchesSelectedTake(entry)) {
      await deps.shots.selectTake(entry.shotId, entry.selectedTakeId ?? null)
    }
    /**
     * **状態も、欄があるときだけ戻す。** 一括採用は採用 Take と状態の両方を動かすので、
     * 状態を戻さないと「採用だけ戻って状態は新しいまま」になる。
     * 採用のあとに当てる（`selectTake` は状態を触らないが、順番を決めておく）。
     */
    const { status } = entry
    if (undoTouchesStatus(entry) && status !== undefined) {
      await deps.shots.updateStatus(entry.shotId, status)
    }
    return null
  } catch (cause) {
    // 握り潰さない（規約 5）。1 件の失敗で残りを止めもしない。
    return `戻せませんでした: ${cause instanceof Error ? cause.message : String(cause)}`
  }
}

export const editBatchRoutes = (deps: EditBatchRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(listRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if ((await deps.projects.findById(projectId)) === null) {
        return c.json(fail(NOT_FOUND_MESSAGE), 404)
      }
      const batches = await deps.editBatches.findByProject(projectId)
      return c.json(okList(batches.map(toEditBatchSummary)), 200)
    })

    .openapi(undoRoute, async (c) => {
      const { projectId, id } = c.req.valid('param')
      if ((await deps.projects.findById(projectId)) === null) {
        return c.json(fail(NOT_FOUND_MESSAGE), 404)
      }

      const batch = await deps.editBatches.findById(id)
      if (batch === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      /** 他 Project の記録を経路に混ぜない（別の作品の値が当たる）。 */
      if (batch.projectId !== projectId) return c.json(fail(FOREIGN_BATCH_MESSAGE), 404)

      if (!canUndo(batch)) {
        return c.json(fail(isUndone(batch) ? ALREADY_UNDONE_MESSAGE : NOTHING_TO_UNDO_MESSAGE), 409)
      }
      /**
       * **先に印を付ける。** 二重の取り消しを DB の条件で止めるため。
       * 付かなかった（`null`）なら、その間に誰かが取り消している。
       */
      const undone = await deps.editBatches.markUndone(batch.id, new Date())
      if (undone === null) return c.json(fail(ALREADY_UNDONE_MESSAGE), 409)

      const restored: ShotId[] = []
      const failed: { shotId: ShotId; reason: string }[] = []
      for (const entry of undone.entries) {
        const reason = await restoreEntry(deps, projectId, undone, entry)
        if (reason === null) restored.push(entry.shotId)
        else failed.push({ shotId: entry.shotId, reason })
      }

      // テロップの記録（見た目のまとめ変更）。プロジェクトのテロップを 1 回で読み、1 件ずつ戻す。
      const clips =
        undone.clipEntries.length === 0
          ? new Map<TimelineClipId, TimelineClip>()
          : new Map((await deps.timelineClips.findByProject(projectId)).map((clip) => [clip.id, clip] as const))
      const restoredClips: TimelineClipId[] = []
      const failedClips: { clipId: TimelineClipId; reason: string }[] = []
      for (const entry of undone.clipEntries) {
        const reason = await restoreClipEntry(deps, clips, entry)
        if (reason === null) restoredClips.push(entry.clipId)
        else failedClips.push({ clipId: entry.clipId, reason })
      }

      return c.json(
        ok({ batch: toEditBatchSummary(undone), restored, failed, restoredClips, failedClips }),
        200,
      )
    })
