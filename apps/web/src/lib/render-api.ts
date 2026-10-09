import { RenderJob, RenderJobId, RenderPreset, RenderScope, type ProjectId } from '@ixa/domain'
import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import type { Requester } from '@/lib/requester'
import { WireTimelineIssue } from '@/lib/timeline-api'

/**
 * 書き出し（レンダリング）の呼び出し口（P55-3）。
 *
 * レンダリングは worker が非同期で走る。`startRender` は**受理されたことしか返さない**。
 * 状態と進捗は `getRenderJob` / `listRenderJobs` を引き直して確かめる。
 *
 * 検証結果の DTO は `@/lib/timeline-api` の `WireTimelineIssue` をそのまま使う。
 * 同じ形を 2 回定義すると、片方だけ直す日が来てズレる（lessons L-016）。
 */

/**
 * API が返す RenderJob。`timelineSnapshot` は 1 件が巨大になるため返らない。
 * JSON に Date が無いので日時列だけ coerce に差し替える。
 */
export const WireRenderJob = RenderJob.omit({ timelineSnapshot: true }).extend({
  createdAt: z.coerce.date(),
  finishedAt: z.coerce.date().nullable(),
})
export type WireRenderJob = z.infer<typeof WireRenderJob>

export const WireRenderJobList = z.array(WireRenderJob)

/** `POST /projects/{projectId}/render` は 202。完了ではなく受理だけを表す。 */
export const WireRenderAccepted = z.object({
  renderJobId: RenderJobId,
  /** error ではない指摘。書き出しは進むが、絵が欠ける可能性がある。 */
  warnings: z.array(WireTimelineIssue),
})
export type WireRenderAccepted = z.infer<typeof WireRenderAccepted>

/**
 * 既定は全体。一部だけなら `range`（制作者 2026-10-02「選択した Shot だけを動画として出力」）。
 * `shot` は型としては受け付けられるが、サーバが 422 で拒否する（範囲で指定する）。
 */
export const FULL_SCOPE: RenderScope = Object.freeze({ type: 'full' })

export const CreateRenderBody = z.object({
  preset: RenderPreset,
  scope: RenderScope,
  /** 書き出しの音量を -14 LUFS（YouTube・SNS の基準）に揃えるか（ADR-0039）。既定は揃える。 */
  normalizeLoudness: z.boolean().default(true),
  /** 前回と中身が同じでも書き出す（人が「もう一度」を選んだときだけ）。 */
  force: z.boolean().default(false),
})
export type CreateRenderBody = z.input<typeof CreateRenderBody>

/**
 * 409 の本文（前回うまくいった書き出しと中身が同じ）。制作者 2026-10-09
 * 「時間かけて書き出ししてから保存で失敗すると時間の無駄」。始める前に知らせて、もう一度かを聞く。
 */
const WireDuplicateRender = z.object({
  error: z.string(),
  duplicateOf: z.object({ renderJobId: RenderJobId, finishedAt: z.string().nullable() }),
})

/** 409 の本文を読む。読めなければ null（呼び出し側が元の例外を投げ直す）。 */
export const parseDuplicateRender = (body: string): StartRenderDuplicate | null => {
  try {
    const parsed = WireDuplicateRender.safeParse(JSON.parse(body) as unknown)
    return parsed.success ? { kind: 'duplicate', message: parsed.data.error, duplicateOf: parsed.data.duplicateOf } : null
  } catch {
    return null
  }
}

/** docs/ARCHITECTURE.md §18 の失敗レスポンス。 */
const WireErrorEnvelope = z.object({
  success: z.literal(false),
  error: z.string(),
  fields: z.record(z.string(), z.array(z.string())).optional(),
})

/**
 * 投入が拒否されたときの中身。`fields.timeline` にタイムライン検証の error が並ぶ。
 * **「拒否された」を「呼び出しに失敗した」と混ぜない。** 前者は直せる、後者は直せない。
 */
export type RenderRejection = {
  readonly message: string
  readonly fields: Readonly<Record<string, readonly string[]>>
}

/**
 * 422 の本文を読む。読めなければ null を返し、呼び出し側が元の例外を投げ直す。
 * ここで握り潰すと「押しても何も起きない」になる。
 */
export const parseRenderRejection = (body: string): RenderRejection | null => {
  const parsed = ((): unknown => {
    try {
      return JSON.parse(body) as unknown
    } catch {
      return null
    }
  })()
  const envelope = WireErrorEnvelope.safeParse(parsed)
  if (!envelope.success) return null
  return { message: envelope.data.error, fields: envelope.data.fields ?? {} }
}

export type StartRenderOutcome =
  | {
      readonly kind: 'accepted'
      readonly renderJobId: RenderJobId
      readonly warnings: readonly WireTimelineIssue[]
    }
  | { readonly kind: 'rejected'; readonly rejection: RenderRejection }
  | StartRenderDuplicate

/** 前回うまくいった書き出しと中身が同じ（まだ始めていない）。`force` でもう一度書き出せる。 */
export type StartRenderDuplicate = {
  readonly kind: 'duplicate'
  readonly message: string
  readonly duplicateOf: { readonly renderJobId: RenderJobId; readonly finishedAt: string | null }
}

export type RenderApi = {
  /**
   * 書き出しをキューへ積む。完了は待たない。
   * タイムラインに error があると受理されず、`rejected` が返る（例外にはしない）。
   */
  startRender: (
    projectId: ProjectId,
    preset: RenderPreset,
    scope?: RenderScope,
    options?: { readonly normalizeLoudness: boolean; readonly force?: boolean },
  ) => Promise<StartRenderOutcome>
  getRenderJob: (id: RenderJobId) => Promise<WireRenderJob>
  listRenderJobs: (projectId: ProjectId) => Promise<WireRenderJob[]>
}

const projectPath = (projectId: ProjectId, suffix: string): string =>
  `/projects/${encodeURIComponent(projectId)}${suffix}`

export const createRenderApi = (requester: Requester): RenderApi => ({
  startRender: async (projectId, preset, scope = FULL_SCOPE, options) => {
    const body = CreateRenderBody.parse({
      preset,
      scope,
      normalizeLoudness: options?.normalizeLoudness ?? true,
      force: options?.force ?? false,
    })
    try {
      const accepted = await requester.post(
        projectPath(projectId, '/render'),
        body,
        WireRenderAccepted,
      )
      return {
        kind: 'accepted',
        renderJobId: accepted.renderJobId,
        warnings: accepted.warnings,
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 422) {
        const rejection = parseRenderRejection(caught.body)
        if (rejection !== null) return { kind: 'rejected', rejection }
      }
      if (caught instanceof ApiError && caught.status === 409) {
        const duplicate = parseDuplicateRender(caught.body)
        if (duplicate !== null) return duplicate
      }
      throw caught
    }
  },

  getRenderJob: async (id) => requester.get(`/renders/${encodeURIComponent(id)}`, WireRenderJob),

  listRenderJobs: async (projectId) =>
    requester.get(projectPath(projectId, '/renders'), WireRenderJobList),
})
