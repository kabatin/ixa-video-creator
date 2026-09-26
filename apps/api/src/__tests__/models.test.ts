import { OpenAPIHono } from '@hono/zod-openapi'
import { createProviderRegistry } from '@ixa/provider-core'
import { createLocalImageToVideoProvider, createStubVideoProvider } from '@ixa/provider-video'
import { describe, expect, it } from 'vitest'
import { modelRoutes } from '../routes/models.js'

/**
 * モデル一覧。画面は生成のモデル選択をこれで作る。
 * ローカルの画像→動画（ADR-0025）は「最初のフレームが要る」「AUTO の候補にしない」を返し、
 * 画面が押す前に理由を出せるようにする。
 */
type WireModel = { id: string; requiresStartFrame: boolean; routable: boolean; costPerSecondUsd: number }

describe('GET /models', () => {
  it('最初のフレームが要るか・AUTO の候補かを返す', async () => {
    const registry = createProviderRegistry([
      createStubVideoProvider({ outputDir: '/tmp/ixa-models-test-stub' }),
      createLocalImageToVideoProvider({ outputDir: '/tmp/ixa-models-test-local' }),
    ])
    const app = new OpenAPIHono().route('/', modelRoutes({ registry }))

    const body = (await (await app.request('/models')).json()) as { data: WireModel[] }

    const local = body.data.find((model) => model.id === 'local/still-motion')
    expect(local).toMatchObject({ requiresStartFrame: true, routable: false, costPerSecondUsd: 0 })
    const stub = body.data.find((model) => model.id === 'stub/veo-like')
    expect(stub).toMatchObject({ requiresStartFrame: false, routable: true })
  })
})
