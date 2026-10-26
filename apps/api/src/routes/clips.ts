import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { EditTransaction, MediaAssetRepository, ProjectRepository, TimelineClipRepository } from '@ixa/db'
import {
  CreateTimelineClipInput as CreateTimelineClipInputSchema,
  ProjectId as ProjectIdSchema,
  TimelineClip as TimelineClipSchema,
  TimelineClipId as TimelineClipIdSchema,
  TimelineTrack as TimelineTrackSchema,
  UpdateTimelineClipPatch as UpdateTimelineClipPatchSchema,
  clipEditSummary,
  clipSnapshotOf,
  isTextStyleUnreadable,
  narrationLineOf,
  newId,
  parseEffectParams,
  type EditBatchClipEdit,
  type EditBatchLineEntry,
  type NarrationLineId,
  type ProjectId,
  type TimelineClip,
  type TimelineClipContent,
  type TimelineTrack,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, VALIDATION_ERROR_MESSAGE, validationHook } from '../errors.js'
import {
  errorContent,
  fail,
  listResponse,
  ok,
  okList,
  successResponse,
  type FieldErrors,
} from '../response.js'
import { normalizeTextTranslation, planTranslationWriteBack } from '../dialogue/translation-write-back.js'
import { changedFieldsOf, recordClipEdits, updateEditOf } from './clip-edit-recording.js'

/**
 * VIDEO1 以外のトラックに載る `TimelineClip` の CRUD（docs/DOMAIN.md §12）。
 * ADR-0006 に従い zod スキーマとハンドラを 1 ファイルに同居させる。
 *
 * VIDEO1 は Shot の投影であり TimelineClip を持たない（ADR-0002）。
 * そのため `TimelineTrack` の enum にも VIDEO1 は無く、指定すると検証で落ちる。
 */

/** 選べるトラックは Domain の enum が唯一の正。ここで列挙し直さない。 */
const TRACK_OPTIONS = TimelineTrackSchema.options

export const INVALID_TRACK_MESSAGE =
  `track に指定できるのは ${TRACK_OPTIONS.join(' / ')} です。` +
  'VIDEO1 は Shot の投影なので TimelineClip を持ちません（ADR-0002）'

export const MISSING_ASSET_MESSAGE = '指定された MediaAsset が存在しません'
export const INVALID_TRIM_RANGE_MESSAGE = 'inSec は outSec より小さい必要があります'
/**
 * トリム範囲と配置尺の食い違いを弾く。
 *
 * **レンダラは `outSec` を読まない。** `inSec` を `startFrom` にして
 * `durationSec` の長さだけ再生する（`packages/render/src/compositions/Timeline.tsx`）。
 * つまり食い違ったまま保存できると、画面で指定した終点が黙って無視される。
 * 速度変更は実装していないので、食い違いに正しい解釈は存在しない。
 */
export const TRIM_LENGTH_MISMATCH_MESSAGE =
  'トリムの長さ（outSec − inSec）と配置する尺（durationSec）を一致させてください'
/**
 * 部分更新でトリムだけ変えると、長さの整合を確かめる相手（durationSec）が無い。
 * 当時はリポジトリに findById が無く既存値を読めず、**検証が素通りした**（いまは読めるが、送らせる規則は変えていない）。
 * 素通りさせると、更新経由でだけ食い違った行が作れてしまう。
 * 両方まとめて送らせる。
 */
export const TRIM_NEEDS_DURATION_MESSAGE =
  'トリム（content）を変えるときは durationSec も一緒に送ってください'

/**
 * 秒の比較許容誤差。`@ixa/timeline` の TIME_EPSILON と同じ値だが、
 * index から公開されていないため同じ値を置く。
 */
const TIME_EPSILON = 1e-6
export const NON_POSITIVE_DURATION_MESSAGE = 'durationSec は 0 より大きい必要があります'
/**
 * テロップの見た目（ADR-0028）が読めない。描く側は既定の見た目に落とすだけなので、
 * 保存させると「指定したのに効かない」まま気付けない。**保存の時点で弾く。**
 * 文字そのもの（昔の形式を含む）は今までどおり受ける。
 */
export const UNREADABLE_TEXT_STYLE_MESSAGE =
  'テロップの見た目を読めません（色は #RRGGBB、大きさ・ずらし・フェードは決まった範囲、知らない項目は付けない）'

/** エフェクト（motion_graphics。ADR-0050）は VFX トラックにだけ置く。描く側は VFX の層の高さで重ねる。 */
export const EFFECT_TRACK_MESSAGE = 'エフェクトは VFX トラックにだけ置けます'

type EffectCheckInput = { readonly track?: TimelineTrack; readonly content?: TimelineClipContent }

/**
 * エフェクトのクリップの検証と、値の正規化（ADR-0050）。
 *
 * **型と値は domain の `parseEffectParams` だけで決める。** 知らない型・範囲外の値・知らない項目は 422 にし、
 * 通った値は既定値を埋めた形で保存する（描く側・画面が「省いた項目」を推測しなくて済む）。
 * PATCH では、送られなかった track・content を既存の行で補ってから置き場所を見る（`effectTrackErrors`）。
 */
export const normalizeEffectClip = <T extends EffectCheckInput>(
  input: T,
): { readonly ok: true; readonly value: T } | { readonly ok: false; readonly fields: FieldErrors } => {
  const { content } = input
  if (content?.type !== 'motion_graphics') return { ok: true, value: input }
  if (input.track !== undefined && input.track !== 'VFX') return { ok: false, fields: { track: [EFFECT_TRACK_MESSAGE] } }
  const parsed = parseEffectParams(content.templateKey, content.params)
  if (!parsed.ok) {
    const key =
      parsed.field === 'templateKey' ? 'content.templateKey' : parsed.field === null ? 'content.params' : `content.params.${parsed.field}`
    return { ok: false, fields: { [key]: [parsed.message] } }
  }
  return {
    ok: true,
    value: { ...input, content: { type: 'motion_graphics', templateKey: parsed.value.templateKey, params: parsed.value.params } },
  }
}

/**
 * エフェクトの置き場所（VFX だけ）を、**更新した後の形**で見る（2026-10-17 のレビュー）。
 * 中身だけを送ってテロップをエフェクトに変える・track だけを送ってエフェクトを VFX の外へ動かす、の両方を断る。
 * 既存の値（params）までは検証し直さない。送られた中身は `normalizeEffectClip` が見る。
 */
export const effectTrackErrors = (
  existing: Pick<TimelineClip, 'track' | 'content'>,
  patch: EffectCheckInput,
): FieldErrors | null => {
  const track = patch.track ?? existing.track
  const content = patch.content ?? existing.content
  return content.type === 'motion_graphics' && track !== 'VFX' ? { track: [EFFECT_TRACK_MESSAGE] } : null
}

/**
 * Domain の enum に「なぜ弾かれるか」が伝わるメッセージだけを足したもの。
 * 値の集合は `TimelineTrackSchema.options` から取るので、両者がずれることはない。
 */
const TrackSchema = z.enum(TRACK_OPTIONS, { errorMap: () => ({ message: INVALID_TRACK_MESSAGE }) })

/** 日時は ISO8601 文字列で返す（他のルートと揃える）。 */
export const TimelineClipResponse = TimelineClipSchema.omit({ createdAt: true })
  .extend({ createdAt: z.string().datetime() })
  .openapi('TimelineClip')
export type TimelineClipResponse = z.infer<typeof TimelineClipResponse>

export const toClipResponse = (clip: TimelineClip): TimelineClipResponse => ({
  ...clip,
  createdAt: clip.createdAt.toISOString(),
})

/** projectId は経路が持つので本文には含めない。正が 2 つになるのを避ける。 */
const CreateClipBody = CreateTimelineClipInputSchema.omit({ projectId: true })
  .extend({ track: TrackSchema })
  .openapi('CreateTimelineClipInput')

const UpdateClipBody = UpdateTimelineClipPatchSchema.extend({
  track: TrackSchema.optional(),
}).openapi('UpdateTimelineClipPatch')

const ProjectParams = z.object({
  projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }),
})
const ClipParams = z.object({
  id: TimelineClipIdSchema.openapi({ param: { name: 'id', in: 'path' } }),
})

/**
 * 絞り込みは任意。**未指定なら全件、未知の値なら 422** であって、
 * 「知らない値は無視して全件」にはしない。
 * 黙って無視すると、呼び出し側は絞り込まれた結果だと信じて全件を読んでしまう。
 */
const ListClipsQuery = z.object({
  track: TrackSchema.optional().openapi({ param: { name: 'track', in: 'query', required: false } }),
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

const listClipsRoute = createRoute({
  method: 'get', path: '/projects/{projectId}/clips', tags: ['clips'],
  summary: 'Project の TimelineClip 一覧（投入順）',
  request: { params: ProjectParams, query: ListClipsQuery },
  responses: {
    200: jsonContent('TimelineClip 一覧', listResponse(TimelineClipResponse)),
    ...commonErrors,
  },
})

const createClipRoute = createRoute({
  method: 'post', path: '/projects/{projectId}/clips', tags: ['clips'],
  summary: 'TimelineClip を作成する',
  request: { params: ProjectParams, body: body(CreateClipBody) },
  responses: {
    201: jsonContent('作成された TimelineClip', successResponse(TimelineClipResponse)),
    ...commonErrors,
  },
})

const updateClipRoute = createRoute({
  method: 'patch', path: '/clips/{id}', tags: ['clips'],
  summary: 'TimelineClip を部分更新する',
  request: { params: ClipParams, body: body(UpdateClipBody) },
  responses: {
    200: jsonContent('更新後の TimelineClip', successResponse(TimelineClipResponse)),
    ...commonErrors,
  },
})

const deleteClipRoute = createRoute({
  method: 'delete', path: '/clips/{id}', tags: ['clips'],
  summary: 'TimelineClip をソフトデリートする',
  request: { params: ClipParams },
  responses: { 204: { description: '削除した（本文なし）' }, ...commonErrors },
})

/**
 * 参照先を見ずに値だけで決まる検証。create と patch で同じ規則を使う。
 *
 * PATCH で省略された項目を検証しないのは、**省略時に既存値がそのまま残る**ため。
 * 既存値は自身が書かれた時点でこの関数を通っている。
 * `content` は部分マージではなくバリアントごと差し替わるので、
 * 差し替えるたびに必ず全体を検証できる（`UpdateTimelineClipPatch` の `content` は partial にならない）。
 */
export const clipShapeErrors = (input: {
  readonly durationSec?: number
  readonly content?: TimelineClipContent
}): FieldErrors | null => {
  const durationError: FieldErrors =
    input.durationSec !== undefined && input.durationSec <= 0
      ? { durationSec: [NON_POSITIVE_DURATION_MESSAGE] }
      : {}

  const trimError: FieldErrors =
    input.content?.type === 'media' && input.content.inSec >= input.content.outSec
      ? { 'content.inSec': [INVALID_TRIM_RANGE_MESSAGE] }
      : {}

  /**
   * 範囲が壊れている（in >= out）ときは長さを比べても意味が無いので、
   * そちらのメッセージだけを返す。2 つ出すと直す順番が分からない。
   */
  const lengthError: FieldErrors =
    input.content?.type === 'media' &&
    input.content.inSec < input.content.outSec &&
    input.durationSec !== undefined &&
    input.durationSec > 0 &&
    Math.abs(input.content.outSec - input.content.inSec - input.durationSec) > TIME_EPSILON
      ? { durationSec: [TRIM_LENGTH_MISMATCH_MESSAGE] }
      : {}

  const styleError: FieldErrors =
    input.content?.type === 'text' && isTextStyleUnreadable(input.content.params)
      ? { 'content.params.style': [UNREADABLE_TEXT_STYLE_MESSAGE] }
      : {}

  const fields: FieldErrors = { ...durationError, ...trimError, ...lengthError, ...styleError }
  return Object.keys(fields).length === 0 ? null : fields
}

export type ClipRoutesDeps = {
  timelineClips: TimelineClipRepository
  /** Project の実在確認だけに使う。 */
  projects: ProjectRepository
  /** media クリップが指す素材の実在確認だけに使う。 */
  mediaAssets: Pick<MediaAssetRepository, 'findById'>
  /** ナレーションのテロップを手で消したとき（その行を「テロップなし」にする。ADR-0038）。ナレーションが無い環境では省く。 */
  onNarrationTelopDeleted?: (lineId: NarrationLineId) => Promise<void>
  /** セリフの字幕の訳文を Shot の行へ書き戻したあと（字幕を作り直す。ADR-0061）。無ければ作り直さない。 */
  onDialogueTranslationWritten?: (projectId: ProjectId) => Promise<void>
  /**
   * 作る・直す・消すを、**書く前に、書き込みと同じトランザクションで**記録する（取り消し。2026-10-19）。
   * **省けない**（省くと戻せない操作が黙って増える）。書き込みが落ちれば記録も残らない。
   */
  transaction: EditTransaction
}

const lineOfClip = (clip: TimelineClip): NarrationLineId | null =>
  clip.content.type === 'text' ? narrationLineOf(clip.content.params) : null

/**
 * 消すときの記録。ナレーションのテロップなら、**その行のテロップ全部**と行の「テロップあり」を控える。
 * 1 枚消すと行は「テロップなし」になり、残りの枚も作り直しで消える。全部を同じ ID で戻し、行も戻せば、
 * 作り直しは今の形と同じと見て何もしない（ID が変わらない）。
 */
const deleteRecordOf = (
  clip: TimelineClip,
  projectClips: readonly TimelineClip[],
): { readonly edits: readonly EditBatchClipEdit[]; readonly lineEntries: readonly EditBatchLineEntry[] } => {
  const lineId = lineOfClip(clip)
  const siblings = lineId === null ? [] : projectClips.filter((each) => each.id !== clip.id && lineOfClip(each) === lineId)
  return {
    edits: [clip, ...siblings].map((each) => ({ op: 'delete', clipId: each.id, before: clipSnapshotOf(each) })),
    // ナレーションのテロップは「テロップあり」の行にしか作られないので、消す前は必ず true。
    lineEntries: lineId === null ? [] : [{ lineId, telop: true }],
  }
}

export const clipRoutes = (deps: ClipRoutesDeps) => {
  const projectMissing = async (projectId: ProjectId): Promise<boolean> =>
    (await deps.projects.findById(projectId)) === null

  /**
   * media クリップの参照先を確認する。
   * 存在しない素材を許すと、レンダリング時に `unresolved` として絵に出るまで気付けない。
   */
  const missingAssetErrors = async (
    content: TimelineClipContent | undefined,
  ): Promise<FieldErrors | null> => {
    if (content === undefined || content.type !== 'media') return null
    const asset = await deps.mediaAssets.findById(content.mediaAssetId)
    return asset === null ? { 'content.mediaAssetId': [MISSING_ASSET_MESSAGE] } : null
  }

  return new OpenAPIHono({ defaultHook: validationHook })
    .openapi(listClipsRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if (await projectMissing(projectId)) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      const { track } = c.req.valid('query')
      const found = await deps.timelineClips.findByProject(projectId)
      const filtered = track === undefined ? found : found.filter((clip) => clip.track === track)
      return c.json(okList(filtered.map(toClipResponse)), 200)
    })
    .openapi(createClipRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if (await projectMissing(projectId)) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      const input = c.req.valid('json')
      const shape = clipShapeErrors(input)
      if (shape !== null) return c.json(fail(VALIDATION_ERROR_MESSAGE, shape), 422)

      const missing = await missingAssetErrors(input.content)
      if (missing !== null) return c.json(fail(VALIDATION_ERROR_MESSAGE, missing), 422)

      const effect = normalizeEffectClip(input)
      if (!effect.ok) return c.json(fail(VALIDATION_ERROR_MESSAGE, effect.fields), 422)
      const translated = normalizeTextTranslation(effect.value)
      if (!translated.ok) return c.json(fail(VALIDATION_ERROR_MESSAGE, translated.fields), 422)

      // 記録は書く前に、同じトランザクションで作る。作る物の ID を先に決めて記録に入れる。
      const id = newId(TimelineClipIdSchema)
      const created = await deps.transaction(async (tx) => {
        await recordClipEdits(tx.editBatches, {
          projectId,
          summary: clipEditSummary('create', translated.value),
          edits: [{ op: 'create', clipId: id }],
        })
        return tx.timelineClips.create({ ...translated.value, projectId, id })
      })
      return c.json(ok(toClipResponse(created)), 201)
    })
    .openapi(updateClipRoute, async (c) => {
      const patch = c.req.valid('json')

      /**
       * 値そのものの壊れ（in >= out、尺 0）を先に見る。
       * 「尺も一緒に送って」より、範囲が壊れていることのほうが根本的で、
       * 先に伝えないと直す順番が分からない。
       */
      const shape = clipShapeErrors(patch)
      if (shape !== null) return c.json(fail(VALIDATION_ERROR_MESSAGE, shape), 422)

      // media のトリムだけを送られると長さを比べる相手が無い。作成時と同じ検証を通せるようにする。
      if (patch.content?.type === 'media' && patch.durationSec === undefined) {
        return c.json(
          fail(VALIDATION_ERROR_MESSAGE, { durationSec: [TRIM_NEEDS_DURATION_MESSAGE] }),
          422,
        )
      }

      const missing = await missingAssetErrors(patch.content)
      if (missing !== null) return c.json(fail(VALIDATION_ERROR_MESSAGE, missing), 422)

      const id = c.req.valid('param').id
      const existing = await deps.timelineClips.findById(id)
      if (existing === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const misplaced = effectTrackErrors(existing, patch)
      if (misplaced !== null) return c.json(fail(VALIDATION_ERROR_MESSAGE, misplaced), 422)

      const effect = normalizeEffectClip(patch)
      if (!effect.ok) return c.json(fail(VALIDATION_ERROR_MESSAGE, effect.fields), 422)
      const translated = normalizeTextTranslation(effect.value)
      if (!translated.ok) return c.json(fail(VALIDATION_ERROR_MESSAGE, translated.fields), 422)
      const value = translated.value

      const edit = updateEditOf(existing, value)
      const after = { track: value.track ?? existing.track, content: value.content ?? existing.content }
      // 読んでから書くまでに消されていれば、リポジトリが DbNotFoundError を投げ、共通ハンドラが 404 にする（記録も残らない）。
      const { updated, wroteBack } = await deps.transaction(async (tx) => {
        // セリフの字幕の訳文は行が正（ADR-0061）。行へ書き戻し、取り消しの記録にも行の「変える前」を入れる。
        const writeBack = await planTranslationWriteBack(tx.shots, existing, value.content)
        if (edit !== null) {
          await recordClipEdits(tx.editBatches, {
            projectId: existing.projectId,
            summary: clipEditSummary('update', after, changedFieldsOf(existing, value)),
            edits: [edit],
            ...(writeBack === null ? {} : { shotEntries: [writeBack.entry] }),
          })
        }
        if (writeBack !== null) await tx.shots.update(writeBack.shotId, { dialogue: [...writeBack.dialogue] })
        return { updated: await tx.timelineClips.update(id, value), wroteBack: writeBack !== null }
      })
      if (wroteBack) await deps.onDialogueTranslationWritten?.(existing.projectId)
      return c.json(ok(toClipResponse(updated)), 200)
    })
    .openapi(deleteClipRoute, async (c) => {
      const id = c.req.valid('param').id
      const existing = await deps.timelineClips.findById(id)
      if (existing === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const record = deleteRecordOf(
        existing,
        lineOfClip(existing) === null ? [] : await deps.timelineClips.findByProject(existing.projectId),
      )
      const removed = await deps.transaction(async (tx) => {
        await recordClipEdits(tx.editBatches, {
          projectId: existing.projectId,
          summary: clipEditSummary('delete', existing),
          ...record,
        })
        return tx.timelineClips.softDelete(id)
      })
      const lineId = lineOfClip(removed)
      if (lineId !== null) await deps.onNarrationTelopDeleted?.(lineId)
      return c.body(null, 204)
    })
}
