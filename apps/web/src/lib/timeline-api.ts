import {
  CreateTimelineClipInput,
  CreateTransitionInput,
  TimelineClip,
  TimelineDocument,
  TimelineTrack,
  Transition,
  UpdateTimelineClipPatch,
  type ProjectId,
  type TimelineClipId,
  type TransitionId,
} from '@ixa/domain'
import { z } from 'zod'
import type { Requester } from '@/lib/requester'

/**
 * タイムライン編集の呼び出し口（P5-4）。
 *
 * 契約は Architect が確定させたもの（tasks/todo.md Phase 5）。ここで増やさない。
 *
 * ```
 * GET    /projects/{projectId}/timeline       TimelineDocument（読み取り）
 * GET    /projects/{projectId}/transitions    一覧
 * POST   /projects/{projectId}/transitions    作成
 * DELETE /transitions/{id}                    削除
 * GET    /projects/{projectId}/clips          一覧（?track= で絞れる）
 * POST   /projects/{projectId}/clips          作成
 * PATCH  /clips/{id}                          更新
 * DELETE /clips/{id}                          削除
 * ```
 *
 * **Transition に PATCH は無い。** 差し替えは削除して作り直す
 * （2 つの Shot の間に 1 本、という不変条件を保ちやすいため）。
 */

/**
 * JSON には Date が無い。日時列だけをドメインのスキーマから coerce に差し替える
 * （`api-schemas.ts` の `WireShot` と同じやり方）。それ以外の制約は流用する。
 */
export const WireTimelineClip = TimelineClip.extend({ createdAt: z.coerce.date() })
export type WireTimelineClip = z.infer<typeof WireTimelineClip>

export const WireTimelineClipList = z.array(WireTimelineClip)

/** Transition に日時列は無いので、ドメインのスキーマをそのまま検証に使う。 */
export const WireTransition = Transition
export type WireTransition = z.infer<typeof WireTransition>

export const WireTransitionList = z.array(WireTransition)

/** `TimelineDocument` も日時を持たない（尺と URL だけ）。そのまま検証する。 */
export const WireTimelineDocument = TimelineDocument
export type WireTimelineDocument = z.infer<typeof WireTimelineDocument>

/** projectId は経路が持つので本文には含めない。正が 2 つになるのを避ける。 */
export const CreateTransitionBody = CreateTransitionInput.omit({ projectId: true })
export type CreateTransitionBody = z.input<typeof CreateTransitionBody>

export const CreateClipBody = CreateTimelineClipInput.omit({ projectId: true })
export type CreateClipBody = z.input<typeof CreateClipBody>

export const UpdateClipBody = UpdateTimelineClipPatch
export type UpdateClipBody = z.input<typeof UpdateClipBody>

/**
 * タイムラインの検証結果。**判定はサーバの `validateTimeline` だけが持つ。**
 * 画面に同じ規則を書くと必ずズレて、レンダリングでは止まるのに画面では合格に見える。
 */
export const WireTimelineIssue = z.object({
  severity: z.enum(['error', 'warning']),
  code: z.string(),
  message: z.string(),
  shotId: z.string().optional(),
})
export type WireTimelineIssue = z.infer<typeof WireTimelineIssue>

export const WireTimelineIssueList = z.array(WireTimelineIssue)

export type TimelineApi = {
  /**
   * プレビューとレンダリングの共通入力。
   * **画面ではこれを「サーバが実際に組み立てられた結果」として使う。**
   * 採用 Take のメディアを解決できなかった Shot は、絵コンテの画像があればそれが `kind: 'image'` で載り、無ければ載らない。
   */
  getTimelineDocument: (projectId: ProjectId) => Promise<WireTimelineDocument>
  /** レンダリング前の検査と同じ結果。画面で判定し直さない。 */
  getTimelineIssues: (projectId: ProjectId) => Promise<WireTimelineIssue[]>
  listTransitions: (projectId: ProjectId) => Promise<WireTransition[]>
  createTransition: (projectId: ProjectId, body: CreateTransitionBody) => Promise<WireTransition>
  deleteTransition: (id: TransitionId) => Promise<void>
  /** `track` を省略すると全件。未知の値はサーバが 422 にする（黙って全件にしない）。 */
  listClips: (projectId: ProjectId, track?: TimelineTrack) => Promise<WireTimelineClip[]>
  createClip: (projectId: ProjectId, body: CreateClipBody) => Promise<WireTimelineClip>
  updateClip: (id: TimelineClipId, patch: UpdateClipBody) => Promise<WireTimelineClip>
  deleteClip: (id: TimelineClipId) => Promise<void>
}

const projectPath = (projectId: ProjectId, suffix: string): string =>
  `/projects/${encodeURIComponent(projectId)}${suffix}`

const clipPath = (id: TimelineClipId): string => `/clips/${encodeURIComponent(id)}`

const transitionPath = (id: TransitionId): string => `/transitions/${encodeURIComponent(id)}`

const clipsPath = (projectId: ProjectId, track: TimelineTrack | undefined): string => {
  const base = projectPath(projectId, '/clips')
  if (track === undefined) return base
  return `${base}?${new URLSearchParams({ track }).toString()}`
}

export const createTimelineApi = (requester: Requester): TimelineApi => ({
  getTimelineDocument: async (projectId) =>
    requester.get(projectPath(projectId, '/timeline'), WireTimelineDocument),

  getTimelineIssues: async (projectId) =>
    requester.get(projectPath(projectId, '/timeline/issues'), WireTimelineIssueList),

  listTransitions: async (projectId) =>
    requester.get(projectPath(projectId, '/transitions'), WireTransitionList),

  createTransition: async (projectId, body) =>
    requester.post(
      projectPath(projectId, '/transitions'),
      CreateTransitionBody.parse(body),
      WireTransition,
    ),

  deleteTransition: async (id) => requester.remove(transitionPath(id)),

  listClips: async (projectId, track) =>
    requester.get(clipsPath(projectId, track), WireTimelineClipList),

  createClip: async (projectId, body) =>
    requester.post(projectPath(projectId, '/clips'), CreateClipBody.parse(body), WireTimelineClip),

  updateClip: async (id, patch) =>
    requester.patch(clipPath(id), UpdateClipBody.parse(patch), WireTimelineClip),

  deleteClip: async (id) => requester.remove(clipPath(id)),
})
