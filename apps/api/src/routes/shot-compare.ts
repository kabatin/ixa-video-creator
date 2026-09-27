import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { MusicAnalysisRepository } from '@ixa/db'
import {
  Seconds as SecondsSchema,
  ShotId as ShotIdSchema,
  TakeId as TakeIdSchema,
  type Shot,
  type Take,
} from '@ixa/domain'
import { buildTimelineDocument, type TimelineSource } from '@ixa/timeline'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, ok, successResponse } from '../response.js'
import {
  TIMELINE_SIGNED_URL_EXPIRES_SEC,
  TimelineDocumentResponse,
  loadProjectBeats,
  loadTimelineSource,
  type TimelineRoutesDeps,
} from './timeline.js'

/**
 * Take の A/B を**曲の拍の上で**比較するための口（PHASE 6.1 / P61-2）。
 *
 * ミュージックビデオの Take の良し悪しは「曲のどこで何が起きるか」で決まる。
 * 静止画を 2 枚並べても判断できないので、**同じ瞬間を、同じ拍の上で**見せる。
 *
 * 返す `document` は「この Shot 1 本だけが乗った、曲の長さのタイムライン」。
 * 組み立ては `@ixa/timeline` の `buildTimelineDocument` にそのまま任せ、
 * 比較専用の組み立てを書かない（lessons L-016）。こうすると `inSec` に
 * `shot.sourceInSec` がそのまま入り、**書き出しと同じ窓**になる（ADR-0011 /
 * `packages/timeline/src/build.ts`）。別に数え直すとプレビューと書き出しがズレる。
 *
 * 署名付き URL は DB に保存せず都度発行し、**例外やログにも出さない**（CLAUDE.md 規約 7）。
 */

/**
 * 比較が成立しなかった理由。**「待てば直る」と「操作しないと直らない」を混ぜない**（L-015）。
 * 文言は画面側（`apps/web/src/lib/take-compare.ts`）が持つ。API は機械が読める符号だけを返す。
 *
 * - `b_not_requested` — B を指定していない。A だけを大きく出す
 * - `b_same_as_a` — A と B が同じ Take。並べても同じ絵にしかならない
 * - `b_not_found` — B の Take が無い（別の Shot の Take もここ）
 * - `b_media_unresolved` — B の Take のメディアを解決できない
 * - `a_media_unresolved` — A の Take のメディアを解決できない。**比較そのものが成立しない**
 */
export const ShotCompareReason = z
  .enum([
    'b_not_requested',
    'b_same_as_a',
    'b_not_found',
    'b_media_unresolved',
    'a_media_unresolved',
  ])
  .openapi('ShotCompareReason')
export type ShotCompareReason = z.infer<typeof ShotCompareReason>

/**
 * 拍の出どころの状態。**「楽曲が無い」「解析が無い」「拍が 0 件」を混ぜない**
 * （`apps/web/src/lib/timeline-snap.ts` の `BeatSource` と同じ考え方 / L-015）。
 * どれも結果は「目盛りに線が出ない」だが、利用者が取るべき次の行動が違う。
 */
export const ShotCompareBeatState = z
  .enum(['available', 'no_beats', 'no_analysis', 'no_track'])
  .openapi('ShotCompareBeatState')
export type ShotCompareBeatState = z.infer<typeof ShotCompareBeatState>

const ComparedTake = z
  .object({
    takeId: TakeIdSchema,
    document: TimelineDocumentResponse,
  })
  .openapi('ComparedTake')

/** 比較する区間。`sourceInSec` は生成尺から編集尺を切り出す位置（ADR-0011）。 */
const ComparedShot = z
  .object({
    startSec: SecondsSchema,
    durationSec: SecondsSchema,
    sourceInSec: SecondsSchema,
  })
  .openapi('ComparedShot')

export const ShotCompareResponse = z
  .object({
    shot: ComparedShot,
    /** 採用候補 A。**音楽トラックを含む。** */
    a: ComparedTake,
    /** 採用候補 B。**音は入れない**（二重に鳴らないため）。 */
    b: ComparedTake.nullable(),
    /** 曲全体の拍（絶対秒）。区間で切るのは画面側の仕事。 */
    beats: z.array(SecondsSchema),
    /**
     * 小節頭（絶対秒）。**拍の部分集合とは限らない**（手で直した解析では
     * 拍の列に無い小節頭がありうる）。目盛りは太さで区別するために使う。
     */
    downbeats: z.array(SecondsSchema),
    beatState: ShotCompareBeatState,
    reason: ShotCompareReason.nullable(),
  })
  .openapi('ShotCompare')
export type ShotCompareResponse = z.infer<typeof ShotCompareResponse>

export type ShotCompareRoutesDeps = TimelineRoutesDeps & {
  musicAnalyses: MusicAnalysisRepository
}

const ShotParams = z.object({
  shotId: ShotIdSchema.openapi({ param: { name: 'shotId', in: 'path' } }),
})

const CompareQuery = z.object({
  a: TakeIdSchema.openapi({ param: { name: 'a', in: 'query' } }),
  b: TakeIdSchema.optional().openapi({ param: { name: 'b', in: 'query' } }),
})

const compareRoute = createRoute({
  method: 'get',
  path: '/shots/{shotId}/compare',
  tags: ['shots'],
  summary: 'Take の A/B を曲の拍の上で比較するための入力を返す',
  request: { params: ShotParams, query: CompareQuery },
  responses: {
    200: {
      description: '比較の入力',
      content: { 'application/json': { schema: successResponse(ShotCompareResponse) } },
    },
    404: errorContent('Shot / Project / A の Take が存在しない'),
    422: errorContent('入力の検証に失敗した'),
    500: errorContent('サーバ内部エラー'),
  },
})

/**
 * 拍は `timeline.ts` の `loadProjectBeats` を呼ぶ。**ここで数え方を書き写さない。**
 *
 * 以前はこのファイルに同じ手順を持っていたが、そちらは小節頭（downbeats）を
 * 落としていたため、A/B 比較の目盛りだけ小節頭を出せなかった。
 * 楽曲の選び方（`pickMasterTrack`）・状態の分け方・`offsetSec` を足さない判断まで
 * 含めて 1 箇所に寄せる（L-016）。
 *
 * `offsetSec` を足さないのは、ビート吸着（`timeline/page.tsx`）もストーリーボードも
 * 解析の値をそのまま絶対秒として使っているため。ここだけ足すと目盛りと吸着がズレる。
 */

/**
 * Take のメディアを署名付き URL に解決する。無ければ undefined。
 *
 * 期限は書き出し用のタイムラインと同じ定数を使う。ここで数字を書き直さない。
 */
/** Take の素材。長さは尺に合わせる速度に使う（ADR-0026）。分からなければ null。 */
type TakeMedia = { readonly url: string; readonly durationSec: number | null }

const resolveTakeMedia = async (
  deps: Pick<ShotCompareRoutesDeps, 'mediaAssets' | 'storage'>,
  take: Take,
): Promise<TakeMedia | undefined> => {
  const asset = await deps.mediaAssets.findById(take.mediaAssetId)
  if (asset === null) return undefined
  const url = await deps.storage.signedGetUrl(asset.storageKey, TIMELINE_SIGNED_URL_EXPIRES_SEC)
  return { url, durationSec: asset.probe?.durationSec ?? null }
}

/**
 * 「この Shot 1 本だけが乗った、曲の長さのタイムライン」の素材。
 *
 * プロジェクト全体の素材（`loadTimelineSource`）を土台にして、Shot と
 * メディアの解決だけを差し替える。音楽トラックの投影（`offsetSec` の扱い・
 * 尺の取り方）を書き写さないため、**書き出しと同じ値**がそのまま入る。
 */
const compareSource = (
  base: TimelineSource,
  shot: Shot,
  media: TakeMedia | undefined,
  withMusic: boolean,
): TimelineSource => ({
  ...base,
  shots: [shot],
  transitions: [],
  clips: [],
  musicTracks: withMusic ? base.musicTracks : [],
  // Shot は 1 本しか乗せないので、どの Shot を聞かれても同じ Take を返す。
  resolveShotMedia: () => media?.url,
  // A と B は長さが違いうるので、速度は Take ごとに決める。
  resolveShotMediaDurationSec: () => media?.durationSec ?? null,
})

/** A の Take として受け付けられるか。別の Shot の Take は「この Shot の Take」ではない。 */
const belongsToShot = (take: Take | null, shot: Shot): take is Take =>
  take !== null && take.shotId === shot.id

export const shotCompareRoutes = (deps: ShotCompareRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook }).openapi(compareRoute, async (c) => {
    const { shotId } = c.req.valid('param')
    const query = c.req.valid('query')

    const shot = await deps.shots.findById(shotId)
    if (shot === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)

    const project = await deps.projects.findById(shot.projectId)
    if (project === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)

    const takeA = await deps.takes.findById(query.a)
    if (!belongsToShot(takeA, shot)) return c.json(fail(NOT_FOUND_MESSAGE), 404)

    // B は「指定が無い」「同じ Take」「見つからない」を別々の理由として残す。
    const takeB =
      query.b === undefined || query.b === query.a ? null : await deps.takes.findById(query.b)

    const [base, beatLoad, urlA] = await Promise.all([
      loadTimelineSource(deps, project),
      loadProjectBeats(deps, shot.projectId),
      resolveTakeMedia(deps, takeA),
    ])

    const usableB = belongsToShot(takeB, shot) ? takeB : null
    const urlB = usableB === null ? undefined : await resolveTakeMedia(deps, usableB)

    const documentA = buildTimelineDocument(compareSource(base, shot, urlA, true))
    const documentB =
      usableB === null || urlB === undefined
        ? null
        : buildTimelineDocument(compareSource(base, shot, urlB, false))

    return c.json(
      ok({
        shot: {
          startSec: shot.startSec,
          durationSec: shot.durationSec,
          sourceInSec: shot.sourceInSec,
        },
        a: { takeId: takeA.id, document: documentA },
        b:
          documentB === null || usableB === null
            ? null
            : { takeId: usableB.id, document: documentB },
        beats: [...beatLoad.beats],
        downbeats: [...beatLoad.downbeats],
        beatState: beatLoad.state,
        reason: compareReason({
          requestedB: query.b,
          sameAsA: query.b !== undefined && query.b === query.a,
          foundB: usableB !== null,
          resolvedB: urlB !== undefined,
          resolvedA: urlA !== undefined,
        }),
      }),
      200,
    )
  })

/**
 * 比較が成立しなかった理由を 1 つ選ぶ。
 *
 * **A が解決できないときを最優先にする。** B の理由を出しても、
 * そもそも比較の土台が無いことが伝わらない。
 */
const compareReason = (input: {
  readonly requestedB: string | undefined
  readonly sameAsA: boolean
  readonly foundB: boolean
  readonly resolvedB: boolean
  readonly resolvedA: boolean
}): ShotCompareReason | null => {
  if (!input.resolvedA) return 'a_media_unresolved'
  if (input.requestedB === undefined) return 'b_not_requested'
  if (input.sameAsA) return 'b_same_as_a'
  if (!input.foundB) return 'b_not_found'
  if (!input.resolvedB) return 'b_media_unresolved'
  return null
}
