import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  EditBatchId as EditBatchIdSchema,
  EditBatchKind as EditBatchKindSchema,
  MusicTrackId as MusicTrackIdSchema,
  NarrationLineId as NarrationLineIdSchema,
  ProjectId as ProjectIdSchema,
  ShotId as ShotIdSchema,
  TimelineClipId as TimelineClipIdSchema,
  TransitionId as TransitionIdSchema,
  canUndo,
  isUndone,
  narrationLineOf,
  undoTouchesSelectedTake,
  undoTouchesStatus,
  type EditBatch,
  type EditBatchClipEntry,
  type EditBatchEntry,
  type EditBatchMusicEntry,
  type MusicTrackId,
  type NarrationLineId,
  type ProjectId,
  type ShotId,
  type TimelineClip,
  type TimelineClipId,
} from '@ixa/domain'
import type {
  EditBatchRepository,
  MusicTrackRepository,
  NarrationLineRepository,
  ProjectRepository,
  ShotCharacterRepository,
  ShotRepository,
  TakeRepository,
  TimelineClipRepository,
} from '@ixa/db'
import {
  clearManualEndFrame,
  clearManualStartFrame,
  replaceManualEndFrame,
  replaceManualStartFrame,
  syncNarrationTelops,
  type NarrationTelopSyncDeps,
  type StartFrameReferences,
} from '@ixa/generation'
import { roughCutLockedReason } from '@ixa/timeline'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, ok, okList, successResponse, listResponse } from '../response.js'
import { undoAssetEdits, type AssetUndoDeps } from './edit-batch-asset-undo.js'
import { undoClipEdits } from './edit-batch-clip-undo.js'
import { VOICE_NOT_RESTORED_REASON, settleVoiceUndo } from './edit-batch-voice-undo.js'
import { undoShotEdits } from './edit-batch-shot-undo.js'
import { undoTransitionEdits, type TransitionUndoDeps } from './edit-batch-transition-undo.js'
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
    /** 変える前を記録したクリップの件数（テロップの見た目のまとめ変更・クリップ 1 件ずつの作る・直す・消す）。 */
    clipCount: z.number().int().nonnegative(),
    /** 変える前を記録したナレーションの行の件数（まとめて並べる。ADR-0038）。 */
    lineCount: z.number().int().nonnegative().default(0),
    /** 変える前を記録した楽曲の数（曲を最後の Shot で切る・欄の直し・マスターの切り替え）。 */
    musicCount: z.number().int().nonnegative().default(0),
    /** 記録した素材の数。 */
    assetCount: z.number().int().nonnegative().default(0),
    /** 記録したトランジションの数（置く・消す。差し替えは 2）。 */
    transitionCount: z.number().int().nonnegative().default(0),
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

const UndoMusicFailure = z
  .object({ musicTrackId: MusicTrackIdSchema, reason: z.string().min(1) })
  .openapi('EditBatchUndoMusicFailure')

const UndoTransitionFailure = z
  .object({ transitionId: TransitionIdSchema, reason: z.string().min(1) })
  .openapi('EditBatchUndoTransitionFailure')

const UndoLineFailure = z
  .object({ lineId: NarrationLineIdSchema, reason: z.string().min(1) })
  .openapi('EditBatchUndoLineFailure')

/** **戻せた分と戻せなかった分を両方返す。** 件数だけでは何が残ったか分からない。 */
export const UndoEditBatchResponse = z
  .object({
    batch: EditBatchSummaryResponse,
    restored: z.array(ShotIdSchema),
    failed: z.array(UndoFailure),
    /** 戻したクリップ（テロップの見た目・クリップ 1 件ずつの記録）。Shot の記録だけなら空。 */
    restoredClips: z.array(TimelineClipIdSchema),
    failedClips: z.array(UndoClipFailure),
    /** 戻したナレーションの行（ADR-0038）。 */
    restoredLines: z.array(NarrationLineIdSchema).default([]),
    failedLines: z.array(UndoLineFailure).default([]),
    /** 戻した楽曲（曲の終わりとフェードアウト）。 */
    restoredMusicTracks: z.array(MusicTrackIdSchema).default([]),
    failedMusicTracks: z.array(UndoMusicFailure).default([]),
    /** 戻したトランジション（置いた物は消し、消した物は同じ ID で置き直す）。 */
    restoredTransitions: z.array(TransitionIdSchema).default([]),
    failedTransitions: z.array(UndoTransitionFailure).default([]),
    /** 戻した素材（キャラクター・ロケーション・ブランド資産・声）の ID。 */
    restoredAssets: z.array(z.string().min(1)).default([]),
    failedAssets: z.array(z.object({ assetId: z.string().min(1), reason: z.string().min(1) }).openapi('EditBatchUndoAssetFailure')).default([]),
    /** 作品の欄を戻したか（作品の直しの記録）。戻せなければ `failedProject` に理由。 */
    restoredProject: z.boolean().default(false),
    failedProject: z.string().min(1).nullable().default(null),
  })
  .openapi('UndoEditBatchResult')
export type UndoEditBatchResponse = z.infer<typeof UndoEditBatchResponse>

export const toEditBatchSummary = (batch: EditBatch): EditBatchSummaryResponse => ({
  id: batch.id,
  kind: batch.kind,
  summary: batch.summary,
  shotCount: batch.entries.length + batch.shotEdits.length,
  clipCount: batch.clipEntries.length + batch.clipEdits.length,
  lineCount: batch.lineEntries.length,
  musicCount: batch.musicEntries.length,
  assetCount: batch.assetEdits.length,
  transitionCount: batch.transitionEdits.length,
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
  /** 実在の確認と、作品の欄を戻す（記録の `projectEntry`）ため。 */
  projects: Pick<ProjectRepository, 'findById' | 'update'>
  /**
   * 戻すのは `update` / `selectTake` / `updateStatus` の 3 つだけ。Take の作成には触らない。
   * 一括採用は採用 Take と状態の両方を動かすので、状態を戻す口も要る。
   */
  shots: Pick<ShotRepository, 'findById' | 'selectTake' | 'update' | 'updateStatus' | 'softDelete' | 'restore'>
  /** 作った Shot を戻すとき、Take ができていないかを見る（ある Shot は消さない）。 */
  takes?: Pick<TakeRepository, 'findByShot'>
  editBatches: Pick<EditBatchRepository, 'findByProject' | 'findById' | 'markUndone'>
  /**
   * テロップの見た目を戻す（`clipEntries`。文字・時間には触らない）と、
   * クリップ 1 件ずつの作る・直す・消すを戻す（`clipEdits`。消したものは論理削除を外す）。
   */
  timelineClips: Pick<TimelineClipRepository, 'findByProject' | 'findById' | 'update' | 'softDelete' | 'restore'>
  /**
   * ナレーションの行の位置を戻す（`lineEntries`。ADR-0038）。戻したあとテロップも作り直す。
   * ナレーションを繋いでいない環境では省く（その記録は作られない）。
   */
  /** 楽曲の曲の終わりとフェードアウトを戻す（`musicEntries`）。楽曲を繋いでいない環境では省く（その記録は戻せないと返す）。 */
  musicTracks?: Pick<MusicTrackRepository, 'update' | 'setMaster'>
  /** Shot の登場人物を戻す（記録の `cast`）。繋いでいない環境では省く（その記録は戻せないと返す）。 */
  shotCharacters?: Pick<ShotCharacterRepository, 'replaceAll'>
  /** Shot の開始フレームを戻す（記録の `startFrame`）。繋いでいない環境では省く。 */
  shotReferences?: StartFrameReferences
  narration?: NarrationTelopSyncDeps & { readonly lines: Pick<NarrationLineRepository, 'findById' | 'update'> }
} & TransitionUndoDeps &
  AssetUndoDeps

/** 同じ記録の Shot の作成・削除を戻せなかったので、尺などを当てない。 */
export const SHOT_EDITS_INCOMPLETE_REASON = '一緒に作った・消した Shot を戻せなかったので、この Shot も戻していません'

/** 戻す行が無い（消された）。 */
export const LINE_NOT_FOUND_REASON = 'ナレーションの行が見つかりません（消された可能性があります）'

/** 戻す楽曲が無い（消された）。 */
export const MUSIC_TRACK_NOT_FOUND_REASON = '楽曲が見つかりません（消された可能性があります）'

/**
 * 楽曲 1 曲を変える前へ戻す。**記録にある欄だけ**を書き戻し、ほかの欄は触らない（欄が無いのは触っていない）。
 * `master` なら、この曲をマスターに戻す。
 */
const restoreMusicEntry = async (
  deps: Pick<EditBatchRoutesDeps, 'musicTracks'>,
  entry: EditBatchMusicEntry,
): Promise<string | null> => {
  if (deps.musicTracks === undefined) return MUSIC_TRACK_NOT_FOUND_REASON
  try {
    const { musicTrackId, master, ...fields } = entry
    if (master === true && (await deps.musicTracks.setMaster(musicTrackId)) === null) return MUSIC_TRACK_NOT_FOUND_REASON
    const patch = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
    if (Object.keys(patch).length === 0) return null
    const restored = await deps.musicTracks.update(musicTrackId, patch)
    return restored === null ? MUSIC_TRACK_NOT_FOUND_REASON : null
  } catch (cause) {
    return `戻せませんでした: ${cause instanceof Error ? cause.message : String(cause)}`
  }
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

/** 作品の欄（変えた欄だけ）を変える前へ戻す。戻せなければ理由を返す（握り潰さない）。 */
const restoreProjectEntry = async (
  deps: Pick<EditBatchRoutesDeps, 'projects'>,
  projectId: ProjectId,
  entry: EditBatch['projectEntry'],
): Promise<string | null> => {
  if (entry === null || Object.keys(entry.patch).length === 0) return null
  try {
    await deps.projects.update(projectId, entry.patch)
    return null
  } catch (cause) {
    return `戻せませんでした: ${cause instanceof Error ? cause.message : String(cause)}`
  }
}

export const ATTACHMENTS_UNAVAILABLE_REASON = '登場人物・開始フレーム・終わりの画像を戻す口がありません'

/**
 * 登場人物・開始フレーム・終わりの画像（欄があるときだけ）を戻す。登場人物は丸ごと、画像は付いていた素材に戻す。
 *
 * **開始フレームの参照は、同じ素材を指す新しい行として作り直す（参照の行の ID は戻らない）。** 参照は
 * `ShotReferenceRepository` の約束どおり更新口を持たず、付け替えはいつも「消して作る」で表す。参照の行を ID で
 * 指すものは無く（生成は Shot から参照を引き直す）、同じ素材・同じ役割に戻れば結果は同じなので、ID までは揃えない。
 */
const restoreAttachments = async (
  deps: Pick<EditBatchRoutesDeps, 'shotCharacters' | 'shotReferences'>,
  entry: EditBatchEntry,
): Promise<string | null> => {
  if (entry.cast !== undefined) {
    if (deps.shotCharacters === undefined) return ATTACHMENTS_UNAVAILABLE_REASON
    await deps.shotCharacters.replaceAll(entry.shotId, entry.cast)
  }
  if (entry.startFrame !== undefined) {
    if (deps.shotReferences === undefined) return ATTACHMENTS_UNAVAILABLE_REASON
    if (entry.startFrame === null) await clearManualStartFrame(deps.shotReferences, entry.shotId)
    else await replaceManualStartFrame(deps.shotReferences, entry.shotId, entry.startFrame)
  }
  if (entry.endFrame !== undefined) {
    if (deps.shotReferences === undefined) return ATTACHMENTS_UNAVAILABLE_REASON
    if (entry.endFrame === null) await clearManualEndFrame(deps.shotReferences, entry.shotId)
    else await replaceManualEndFrame(deps.shotReferences, entry.shotId, entry.endFrame)
  }
  return null
}

/** 記録 1 件ぶんを Shot へ当て直す。当てなかった / 当てられなかったときは理由を返す。 */
const restoreEntry = async (
  deps: Pick<EditBatchRoutesDeps, 'shots' | 'shotCharacters' | 'shotReferences'>,
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
    return await restoreAttachments(deps, entry)
  } catch (cause) {
    // 握り潰さない（規約 5）。1 件の失敗で残りを止めもしない。
    return `戻せませんでした: ${cause instanceof Error ? cause.message : String(cause)}`
  }
}

/**
 * ナレーションのテロップは行から作り直される。戻したテロップが今の行の形と違えば（手で直していた・前の作り直しが
 * 済んでいなかった）、作り直しで別の ID に替わる。**直後に消えた ID は返さず**、代わりにその行の今のテロップを返す。
 */
const settledRestoredClips = async (
  deps: Pick<EditBatchRoutesDeps, 'timelineClips'>,
  projectId: ProjectId,
  restored: readonly TimelineClipId[],
  lineIds: readonly NarrationLineId[],
): Promise<readonly TimelineClipId[]> => {
  const alive = await deps.timelineClips.findByProject(projectId)
  const aliveIds = new Set<string>(alive.map((clip) => clip.id))
  const kept = restored.filter((id) => aliveIds.has(id))
  if (kept.length === restored.length) return restored
  const lines = new Set<string>(lineIds)
  const replacements = alive
    .filter((clip) => clip.content.type === 'text' && lines.has(narrationLineOf(clip.content.params) ?? ''))
    .map((clip) => clip.id)
    .filter((id) => !kept.includes(id))
  return [...kept, ...replacements]
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

      // Shot の作成・削除を先に戻す（結合を戻すと消した Shot が戻ってから、残した Shot の尺が戻る）。
      const shotEdits = await undoShotEdits(deps, undone.shotEdits)
      const restored: ShotId[] = [...shotEdits.restored]
      const failed: { shotId: ShotId; reason: string }[] = [...shotEdits.failed]
      // 作成・削除が 1 件でも戻らなければ、同じ記録の尺などは当てない（結合の戻しで穴・分割の戻しで重なりを作らない）。
      const shotsSettled = shotEdits.failed.length === 0
      for (const entry of undone.entries) {
        const reason = shotsSettled ? await restoreEntry(deps, projectId, undone, entry) : SHOT_EDITS_INCOMPLETE_REASON
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
      // クリップ 1 件ずつの記録。行（ナレーションのテロップ）より先に戻す（行を戻すとテロップを作り直すため）。
      const clipEdits = await undoClipEdits(deps, undone.clipEdits)
      restoredClips.push(...clipEdits.restored)
      failedClips.push(...clipEdits.failed)

      // 素材は行より先に戻す（消した声を戻してから、その声で話していた行を戻す）。
      const assets = await undoAssetEdits(deps, undone.assetEdits)
      const failedVoices = await settleVoiceUndo(deps, projectId, undone.assetEdits, assets)

      // ナレーションの行の位置（ADR-0038）。戻してからテロップを作り直す（テロップは行から導かれる）。
      const restoredLines: NarrationLineId[] = []
      const failedLines: { lineId: NarrationLineId; reason: string }[] = []
      for (const entry of undone.lineEntries) {
        const line = await deps.narration?.lines.findById(entry.lineId)
        if (line === undefined || line === null) {
          failedLines.push({ lineId: entry.lineId, reason: LINE_NOT_FOUND_REASON })
          continue
        }
        // 話していた声を戻せなかったら、行も戻さない（戻すと消えた声を指す）。
        if (typeof entry.voiceProfileId === 'string' && failedVoices.has(entry.voiceProfileId)) {
          failedLines.push({ lineId: entry.lineId, reason: VOICE_NOT_RESTORED_REASON })
          continue
        }
        // **欄が無ければ触っていないので戻さない。**
        await deps.narration?.lines.update(entry.lineId, {
          ...(entry.startSec === undefined ? {} : { startSec: entry.startSec }),
          ...(entry.telop === undefined ? {} : { telop: entry.telop }),
          ...(entry.voiceProfileId === undefined ? {} : { voiceProfileId: entry.voiceProfileId }),
        })
        restoredLines.push(entry.lineId)
      }
      if (restoredLines.length > 0 && deps.narration !== undefined) {
        await syncNarrationTelops(deps.narration, projectId)
      }
      const settledClips =
        restoredLines.length === 0 ? restoredClips : await settledRestoredClips(deps, projectId, restoredClips, restoredLines)

      const restoredMusicTracks: MusicTrackId[] = []
      const failedMusicTracks: { musicTrackId: MusicTrackId; reason: string }[] = []
      for (const entry of undone.musicEntries) {
        const reason = await restoreMusicEntry(deps, entry)
        if (reason === null) restoredMusicTracks.push(entry.musicTrackId)
        else failedMusicTracks.push({ musicTrackId: entry.musicTrackId, reason })
      }

      const transitions = await undoTransitionEdits(deps, projectId, undone.transitionEdits)
      const projectReason = await restoreProjectEntry(deps, projectId, undone.projectEntry)

      return c.json(
        ok({
          batch: toEditBatchSummary(undone),
          restored,
          failed,
          restoredClips: [...settledClips],
          failedClips,
          restoredLines,
          failedLines,
          restoredMusicTracks,
          failedMusicTracks,
          restoredTransitions: [...transitions.restored],
          failedTransitions: [...transitions.failed],
          restoredAssets: [...assets.restored],
          failedAssets: [...assets.failed],
          restoredProject: undone.projectEntry !== null && projectReason === null,
          failedProject: projectReason,
        }),
        200,
      )
    })
