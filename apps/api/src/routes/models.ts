import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { ProviderRegistry } from '@ixa/provider-core'
import { validationHook } from '../errors.js'
import { ok, successResponse } from '../response.js'

/**
 * 登録されている映像モデルの一覧。
 *
 * **画面がモデルの性質を書き写さないための口。** これが無かったので、
 * 生成の選択肢は `AUTO` 固定で、Project を作るときに「その AI なら何 fps か」を
 * 人が調べて手で入れるしかなかった。宣言（`VideoModelDescriptor`）を唯一の正にする。
 *
 * **登録されているものだけを返す。** 鍵が無くて registry に入っていないモデルは
 * ここにも出ない。出してしまうと「選べるのに使えない」ことになる。
 */

const DurationSupport = z
  .discriminatedUnion('mode', [
    z.object({ mode: z.literal('enum'), values: z.array(z.number().positive()) }),
    z.object({
      mode: z.literal('range'),
      min: z.number().positive(),
      max: z.number().positive(),
      step: z.number().positive().optional(),
    }),
  ])
  .openapi('DurationSupport')

const VideoModel = z
  .object({
    id: z.string(),
    providerId: z.string(),
    label: z.string(),
    /**
     * このモデルが出す素材の fps。
     * **Project の fps を決めるときの根拠になる。** 書き出しは `doc.fps` へ揃えるので
     * 一致は必須ではないが、揃えておけば変換が要らない。
     */
    fps: z.array(z.number().positive()),
    resolutions: z.array(z.object({ width: z.number().int(), height: z.number().int() })),
    aspectRatios: z.array(z.string()),
    durations: DurationSupport,
    maxReferenceImages: z.number().int().nonnegative(),
    costPerSecondUsd: z.number().nonnegative(),
    /** 音を一緒に作れるか。このシステムは楽曲を別に持つので、基本は使わない。 */
    audioGeneration: z.boolean(),
    /** 最初のフレーム（画像）が無ければ使えない（ADR-0025）。 */
    requiresStartFrame: z.boolean(),
    /** AUTO（ルーター）の候補になるか。false は明示して選ぶモデル。 */
    routable: z.boolean(),
  })
  .openapi('VideoModel')

const modelsRoute = createRoute({
  method: 'get',
  path: '/models',
  tags: ['models'],
  summary: '登録されている映像モデルと、その性質',
  responses: {
    200: {
      description: 'registry にいるモデル',
      content: { 'application/json': { schema: successResponse(z.array(VideoModel)) } },
    },
  },
})

export type ModelsDeps = {
  readonly registry: ProviderRegistry
}

export const modelRoutes = (deps: ModelsDeps) =>
  new OpenAPIHono({ defaultHook: validationHook }).openapi(modelsRoute, (c) =>
    c.json(
      ok(
        deps.registry.providers.flatMap((provider) =>
          provider.models.map((model) => ({
            id: model.id,
            providerId: model.providerId,
            label: model.label,
            fps: [...model.capabilities.fps],
            resolutions: model.capabilities.resolutions.map((r) => ({
              width: r.width,
              height: r.height,
            })),
            aspectRatios: [...model.capabilities.aspectRatios],
            durations: model.capabilities.durations,
            maxReferenceImages: model.capabilities.referenceImages.max,
            costPerSecondUsd: model.economics.costPerSecondUsd,
            audioGeneration: model.capabilities.audioGeneration,
            requiresStartFrame: model.capabilities.requiresStartFrame === true,
            routable: model.routable !== false,
          })),
        ),
      ),
      200,
    ),
  )
