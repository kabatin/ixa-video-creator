import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createApiClient, IxaApiError, IxaUnreachableError } from '../api-client.js'
import { waitForChecks, type Check } from '../lib/wait-loop.js'
import { createLogger } from '../logger.js'
import { defineTool, describeError } from '../tool-def.js'
import { editShotsTool } from '../tools/edit-shots.js'
import { generateMusicTool } from '../tools/music-generation.js'
import { setAiTool } from '../tools/status.js'
import { generateTakesTool } from '../tools/takes.js'
import { waitTool } from '../tools/wait.js'
import { BASE, createFakeApi, depsFor, fakeClock, jsonOf, textOf, TOKEN, ulid } from './fake-api.js'

/** 独立レビュー（2026-10-17）で見つかった問題ごとの試験。 */

const PROJECT = ulid('PJ1')
const SHOT_A = ulid('SA1')
const SHOT_B = ulid('SB1')
const TAKE = ulid('TK1')
const MODEL = 'vpipe/minimax-h3-turbo'
const SEED_OVER = 2 ** 31

const started = (jobId: string) => ({
  jobIds: [jobId],
  specHash: 'x'.repeat(64),
  resolvedModel: MODEL,
  duplicateOfTakeId: null,
  stretchedToFit: false,
})

describe('1. 親 Take には作り直しの理由が要る', () => {
  it('parentTakeId だけでは API を呼ばずに断る', async () => {
    const fake = createFakeApi([])
    const result = await generateTakesTool.run(
      { projectId: PROJECT, shotIds: [SHOT_A], model: MODEL, parentTakeId: TAKE },
      depsFor(fake),
    )
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('regenerationReason')
    expect(fake.calls).toHaveLength(0)
  })

  it('理由は前後の空白を落とし、1〜200 文字', async () => {
    const deps = depsFor(createFakeApi([]))
    const base = { projectId: PROJECT, shotIds: [SHOT_A], model: MODEL, parentTakeId: TAKE }
    expect(textOf(await generateTakesTool.run({ ...base, regenerationReason: '   ' }, deps))).toContain('regenerationReason')
    expect(textOf(await generateTakesTool.run({ ...base, regenerationReason: 'あ'.repeat(201) }, deps))).toContain(
      'regenerationReason',
    )
  })

  it('理由を親と一緒に送る', async () => {
    const fake = createFakeApi([{ method: 'POST', path: `/shots/${SHOT_A}/generate`, status: 202, data: started(ulid('JB1')) }])
    await generateTakesTool.run(
      { projectId: PROJECT, shotIds: [SHOT_A], model: MODEL, parentTakeId: TAKE, regenerationReason: ' 本番で作り直す ' },
      depsFor(fake),
    )
    expect(fake.calls[0]?.body).toEqual({ model: MODEL, count: 1, parentTakeId: TAKE, regenerationReason: '本番で作り直す' })
  })
})

describe('2. 曲の API（main の music-generate.ts）と揃える', () => {
  it('prompt は 1000・lyrics は 4000 文字まで（domain の上限）', async () => {
    const deps = depsFor(createFakeApi([]))
    const base = { projectId: PROJECT, prompt: 'pop' }
    expect(textOf(await generateMusicTool.run({ ...base, prompt: 'a'.repeat(1001) }, deps))).toContain('prompt')
    expect(textOf(await generateMusicTool.run({ ...base, lyrics: 'a'.repeat(4001) }, deps))).toContain('lyrics')
  })

  it('尺の既定は 60 秒、prompt と title の空白を落とす', async () => {
    const JOB = ulid('JB2')
    const fake = createFakeApi([{ method: 'POST', path: `/projects/${PROJECT}/music/generate`, status: 202, data: { jobId: JOB } }])
    jsonOf(await generateMusicTool.run({ projectId: PROJECT, prompt: ' pop ', title: ' 夏 ' }, depsFor(fake)))
    expect(fake.calls[0]?.body).toEqual({ prompt: 'pop', lyrics: '', durationSec: 60, instrumental: false, count: 1, title: '夏' })
  })

  it('set_ai は曲の用途（music）を受ける', async () => {
    const settings = { text: 'claude_cli', image: 'klein', video: 'vpipe', voice: 'macos_say', transcribe: 'local', music: 'stub' }
    const fake = createFakeApi([
      { method: 'GET', path: '/ai/settings', data: { settings, source: 'saved' } },
      { method: 'PUT', path: '/ai/settings', data: { settings: { ...settings, music: 'ace_step' }, source: 'saved' } },
    ])
    jsonOf(await setAiTool.run({ purpose: 'music', tool: 'ace_step' }, depsFor(fake)))
    expect(fake.callsTo('PUT', '/ai/settings')[0]?.body).toEqual({ ...settings, music: 'ace_step' })
  })

  it('wait {kind:music} は GET /music-jobs/{id} の応答（main の形）を読む', async () => {
    const JOB = ulid('JB3')
    const TRACK = ulid('TR1')
    const fake = createFakeApi([
      {
        method: 'GET',
        path: `/music-jobs/${JOB}`,
        data: {
          id: JOB,
          status: 'succeeded',
          prompt: 'pop',
          durationSec: 60,
          instrumental: false,
          count: 1,
          title: null,
          musicTrackIds: [TRACK],
          error: null,
          queuedAt: '2026-10-17T00:00:00.000Z',
          finishedAt: '2026-10-17T00:01:00.000Z',
        },
      },
    ])
    const outcome = jsonOf(await waitTool.run({ jobs: [{ kind: 'music', id: JOB }] }, depsFor(fake)))
    expect(outcome).toMatchObject({ done: true, results: [{ state: 'succeeded', musicTrackIds: [TRACK] }] })
  })
})

describe('3. Shot ごとの生成は 1 本の失敗で他を失わない', () => {
  it('失敗した Shot は理由つきで返し、積めたジョブは残す', async () => {
    const fake = createFakeApi([
      { method: 'POST', path: `/shots/${SHOT_A}/generate`, status: 202, data: started(ulid('JB1')) },
      { method: 'POST', path: `/shots/${SHOT_B}/generate`, status: 422, data: '最初のコマがありません' },
    ])
    const result = jsonOf(
      await generateTakesTool.run({ projectId: PROJECT, shotIds: [SHOT_A, SHOT_B], model: MODEL, seed: 1 }, depsFor(fake)),
    ) as { results: Record<string, unknown>[]; jobs: unknown[] }
    expect(result.results[0]).toMatchObject({ shotId: SHOT_A, ok: true, jobIds: [ulid('JB1')] })
    expect(result.results[1]).toEqual({ shotId: SHOT_B, ok: false, reason: expect.stringContaining('最初のコマがありません') as unknown })
    expect(result.jobs).toEqual([{ kind: 'generation', id: ulid('JB1') }])
  })
})

const throwingCheck = (error: Error): Check => ({ label: { kind: 'x' }, poll: () => Promise.reject(error) })

describe('4. 1 つの問い合わせが落ちても待ちを止めない', () => {
  it('404・422 はその対象だけ失敗として終わらせる', async () => {
    const outcome = await waitForChecks(
      [throwingCheck(new IxaApiError(404, 'ジョブがありません', null, null, 'GET', '/generation-jobs/x'))],
      fakeClock(),
      { maxWaitSec: 30 },
    )
    expect(outcome.done).toBe(true)
    expect(outcome.results[0]).toMatchObject({ state: 'failed', error: expect.stringContaining('ジョブがありません') as unknown })
  })

  it('届かない・5xx はまだ途中とみなして待ち続ける', async () => {
    const outcome = await waitForChecks(
      [
        throwingCheck(new IxaUnreachableError(BASE)),
        throwingCheck(new IxaApiError(503, '混んでいます', null, null, 'GET', '/renders/x')),
      ],
      fakeClock(),
      { maxWaitSec: 30 },
    )
    expect(outcome).toMatchObject({ done: false, timedOut: true })
    expect(outcome.results.map((r) => r.state)).toEqual(['pending', 'pending'])
  })
})

describe('5. 解像度上げは失敗が見えないので、時間切れに手がかりを付ける', () => {
  it('upscale がまだのまま時間切れなら list_takes を見るよう促す', async () => {
    const fake = createFakeApi([{ method: 'GET', path: `/shots/${SHOT_A}/takes`, data: [] }])
    const outcome = jsonOf(
      await waitTool.run({ jobs: [{ kind: 'upscale', shotId: SHOT_A, takeId: TAKE }], maxWaitSec: 10 }, depsFor(fake)),
    ) as Record<string, unknown>
    expect(outcome.timedOut).toBe(true)
    expect(String(outcome.hint)).toContain('list_takes')
  })

  it('ほかの種類だけの時間切れには手がかりを付けない', async () => {
    const RENDER = ulid('RN1')
    const fake = createFakeApi([
      {
        method: 'GET',
        path: `/renders/${RENDER}`,
        data: { id: RENDER, status: 'rendering', progress: 0.1, outputAssetId: null, error: null, preset: 'master_1080p', scope: { type: 'full' }, createdAt: 'x' },
      },
    ])
    const outcome = jsonOf(await waitTool.run({ jobs: [{ kind: 'render', id: RENDER }], maxWaitSec: 10 }, depsFor(fake))) as Record<string, unknown>
    expect(outcome.timedOut).toBe(true)
    expect(outcome.hint).toBeUndefined()
  })
})

const captureLogger = () => {
  const lines: string[] = []
  const stream = new Writable({
    write: (chunk: Buffer, _enc, done) => {
      lines.push(chunk.toString())
      done()
    },
  })
  return { logger: createLogger('warn', stream), lines }
}

describe('6. 失敗のログは原因の連なりを残し、置き場の失敗は別の文にする', () => {
  it('ツールの失敗は例外そのものをログに出す（cause まで）', async () => {
    const { logger, lines } = captureLogger()
    const tool = defineTool({
      name: 'boom',
      description: 'x',
      input: z.object({}),
      handler: () => Promise.reject(new Error('外側', { cause: new Error('内側の原因') })),
    })
    await tool.run({}, depsFor(createFakeApi([]), { logger }))
    expect(lines.join('')).toContain('内側の原因')
  })

  it('署名付き URL へ届かないときは「保存先に届きませんでした」（URL は出さない）', async () => {
    const client = createApiClient({ baseUrl: BASE, token: TOKEN, fetch: () => Promise.reject(new Error('ECONNREFUSED')) })
    const down = await client.download('http://storage.test/files/a?sig=SIG').catch((e: unknown) => e)
    const up = await client.upload('http://storage.test/files/b?sig=SIG', new Uint8Array([1]), 'image/png').catch((e: unknown) => e)
    ;[down, up].forEach((error) => {
      expect(describeError(error)).toContain('保存先に届きませんでした')
      expect(describeError(error)).not.toContain('SIG')
      expect(describeError(error)).not.toContain('IXA_API_URL')
    })
  })
})

describe('7. cut 以外のつなぎは長さを持つ', () => {
  const routes = [
    {
      method: 'GET',
      path: `/projects/${PROJECT}/shots`,
      data: [SHOT_A, SHOT_B].map((id, order) => ({
        id,
        order,
        code: `CUT${String(order)}`,
        startSec: order * 2,
        durationSec: 2,
        mood: null,
        camera: { size: 'wide', angleH: null, angle: null, lensMm: null, movement: null, movementIntensity: null },
        locationId: null,
        selectedTakeId: null,
        status: 'draft',
      })),
    },
    { method: 'GET', path: `/projects/${PROJECT}/transitions`, data: [] },
    { method: 'POST', path: `/projects/${PROJECT}/transitions`, status: 201, data: { id: ulid('TN1'), fromShotId: SHOT_A, toShotId: SHOT_B, type: 'dissolve' } },
  ]

  it('長さを省けば 0.5 秒で送る（黙って cut にしない）', async () => {
    const fake = createFakeApi(routes)
    await editShotsTool.run({ projectId: PROJECT, edits: [{ shotIds: [SHOT_A], transitionToNext: { type: 'dissolve' } }] }, depsFor(fake))
    expect(fake.callsTo('POST', `/projects/${PROJECT}/transitions`)[0]?.body).toMatchObject({ type: 'dissolve', durationSec: 0.5 })
  })

  it('cut 以外で 0 秒は断る。cut の 0 秒は通す', async () => {
    const fake = createFakeApi(routes)
    const bad = await editShotsTool.run(
      { projectId: PROJECT, edits: [{ shotIds: [SHOT_A], transitionToNext: { type: 'wipe', durationSec: 0 } }] },
      depsFor(fake),
    )
    expect(bad.isError).toBe(true)
    expect(textOf(bad)).toContain('durationSec')
    expect(fake.callsTo('POST', /transitions$/)).toHaveLength(0)
    const cut = await editShotsTool.run(
      { projectId: PROJECT, edits: [{ shotIds: [SHOT_A], transitionToNext: { type: 'cut', durationSec: 0 } }] },
      depsFor(fake),
    )
    expect(cut.isError).toBeUndefined()
  })
})

describe('9. seed は 2^31-1 まで', () => {
  it('曲も動画も 2^31 を断る', async () => {
    const deps = depsFor(createFakeApi([]))
    expect(textOf(await generateMusicTool.run({ projectId: PROJECT, prompt: 'p', seed: SEED_OVER }, deps))).toContain('seed')
    expect(textOf(await generateTakesTool.run({ projectId: PROJECT, shotIds: [SHOT_A], model: MODEL, seed: SEED_OVER }, deps))).toContain(
      'seed',
    )
  })
})
