import { describe, expect, it } from 'vitest'
import { waitWith } from '../tools/wait.js'
import { GenerateSfxInput, generateSfxTool, listSfxTool, removeSfxTool, suggestSfxTool } from '../tools/sfx.js'
import { createFakeApi, depsFor, jsonOf, textOf, ulid } from './fake-api.js'

/** 効果音（ADR-0052）。きっかけは domain の `SfxCue` で確かめ、置いた音は SFX の段の media クリップ。 */

const PROJECT = ulid('PJ1')
const JOB_A = ulid('SJA')
const JOB_B = ulid('SJB')
const CLIP_A = ulid('CA1')
const CLIP_B = ulid('CB1')
const FOREIGN = ulid('ZZ9')

describe('generate_sfx', () => {
  it('きっかけをそのまま送り（音量は既定 0.8）、モデルは tool として渡す。待つ先を返す', async () => {
    const fake = createFakeApi([
      { method: 'POST', path: `/projects/${PROJECT}/sfx/generate`, status: 202, data: { jobIds: [JOB_A, JOB_B] } },
    ])
    const result = jsonOf(
      await generateSfxTool.run(
        {
          projectId: PROJECT,
          cues: [
            { startSec: 1, durationSec: 1, prompt: 'cinematic impact hit' },
            { startSec: 4, durationSec: 2, prompt: 'car engine revving', negativePrompt: 'music', volume: 1.2 },
          ],
          model: 'moss_sfx',
          count: 2,
        },
        depsFor(fake),
      ),
    ) as { jobIds: string[]; next: { jobs: unknown[] } }
    expect(fake.callsTo('POST', `/projects/${PROJECT}/sfx/generate`)[0]?.body).toEqual({
      cues: [
        { startSec: 1, durationSec: 1, prompt: 'cinematic impact hit', volume: 0.8 },
        { startSec: 4, durationSec: 2, prompt: 'car engine revving', negativePrompt: 'music', volume: 1.2 },
      ],
      count: 2,
      tool: 'moss_sfx',
    })
    expect(result.jobIds).toEqual([JOB_A, JOB_B])
    expect(result.next.jobs).toEqual([
      { kind: 'sfx', id: JOB_A },
      { kind: 'sfx', id: JOB_B },
    ])
  })

  it.each(['stable_audio_medium_sfx', 'stable_audio_sfx', 'moss_sfx'] as const)('モデル %s を選べ、そのまま tool で送る', async (model) => {
    const fake = createFakeApi([{ method: 'POST', path: `/projects/${PROJECT}/sfx/generate`, status: 202, data: { jobIds: [JOB_A] } }])
    await generateSfxTool.run({ projectId: PROJECT, cues: [{ startSec: 0, durationSec: 1, prompt: 'whoosh' }], model }, depsFor(fake))
    expect(fake.callsTo('POST', `/projects/${PROJECT}/sfx/generate`)[0]?.body).toMatchObject({ tool: model })
  })

  it('説明はメインを Medium、Small を速い控え、MOSS を遅い控えと言う', () => {
    const description = GenerateSfxInput.shape.model.description ?? ''
    expect(description).toMatch(/stable_audio_medium_sfx is the main/)
    expect(description).toMatch(/stable_audio_sfx is a fast fallback/)
    expect(description).toMatch(/moss_sfx is a slow fallback/)
  })

  it('モデルを省けば tool を送らない（作品の効果音の AI）', async () => {
    const fake = createFakeApi([{ method: 'POST', path: `/projects/${PROJECT}/sfx/generate`, status: 202, data: { jobIds: [JOB_A] } }])
    await generateSfxTool.run({ projectId: PROJECT, cues: [{ startSec: 0, durationSec: 1, prompt: 'whoosh' }] }, depsFor(fake))
    expect(fake.callsTo('POST', `/projects/${PROJECT}/sfx/generate`)[0]?.body).not.toHaveProperty('tool')
  })
})

describe('suggest_sfx', () => {
  it('案と、そのまま generate_sfx に渡せるきっかけを返す', async () => {
    const cue = { startSec: 1, durationSec: 1, prompt: 'cinematic impact hit', volume: 0.8 }
    const fake = createFakeApi([
      { method: 'GET', path: `/projects/${PROJECT}/sfx/suggestions`, data: [{ kind: 'impact', reason: 'フラッシュに合わせた衝撃音', cue }] },
    ])
    const result = jsonOf(await suggestSfxTool.run({ projectId: PROJECT }, depsFor(fake))) as { cues: unknown[] }
    expect(result.cues).toEqual([cue])
  })
})

describe('list_sfx / remove_sfx', () => {
  const clips = [
    { id: CLIP_B, track: 'SFX', startSec: 3, durationSec: 1, content: { type: 'media', mediaAssetId: ulid('MA2'), volume: 0.8 } },
    { id: ulid('FX1'), track: 'VFX', startSec: 0, durationSec: 0.4, content: { type: 'motion_graphics', templateKey: 'flash', params: {} } },
    { id: CLIP_A, track: 'SFX', startSec: 1, durationSec: 0.5, content: { type: 'media', mediaAssetId: ulid('MA1'), volume: 1 } },
  ]

  it('SFX の段の音だけを時刻順に返し、ixa が作った音には種を添える', async () => {
    const fake = createFakeApi([
      { method: 'GET', path: `/projects/${PROJECT}/clips`, data: clips },
      {
        method: 'GET',
        path: `/projects/${PROJECT}/sfx-jobs`,
        data: [{ status: 'succeeded', error: null, timelineClipId: CLIP_B, mediaAssetIds: [ulid('MA2')], seedsUsed: [42] }],
      },
    ])
    const result = jsonOf(await listSfxTool.run({ projectId: PROJECT }, depsFor(fake))) as { sounds: { id: string; seedUsed: number | null }[] }
    expect(result.sounds.map((s) => [s.id, s.seedUsed])).toEqual([
      [CLIP_A, null],
      [CLIP_B, 42],
    ])
  })

  it('効果音だけを外し、ほかのクリップは理由つきで断る', async () => {
    const fake = createFakeApi([
      { method: 'GET', path: `/projects/${PROJECT}/clips`, data: clips },
      { method: 'DELETE', path: `/clips/${CLIP_A}`, status: 204 },
    ])
    const result = jsonOf(await removeSfxTool.run({ projectId: PROJECT, clipIds: [CLIP_A, ulid('FX1')] }, depsFor(fake))) as {
      removed: string[]
      failures: { reason: string }[]
    }
    expect(result.removed).toEqual([CLIP_A])
    expect(result.failures[0]?.reason).toMatch(/効果音ではない/)
    expect(fake.callsTo('DELETE', `/clips/${ulid('FX1')}`)).toEqual([])
  })

  it('この作品に無いクリップが 1 つでもあれば、何も消さずに断る', async () => {
    const fake = createFakeApi([
      { method: 'GET', path: `/projects/${PROJECT}/clips`, data: clips },
      { method: 'DELETE', path: /\/clips\//, status: 204 },
    ])
    const result = await removeSfxTool.run({ projectId: PROJECT, clipIds: [CLIP_A, FOREIGN] }, depsFor(fake))
    expect(textOf(result)).toContain(`この作品に無いクリップです: ${FOREIGN}`)
    expect(fake.callsTo('DELETE', /\/clips\//)).toEqual([])
  })
})

describe('wait（kind: sfx）', () => {
  it('効果音のジョブが終わるまで待ち、置いたクリップを返す。失敗は理由つき', async () => {
    const fake = createFakeApi([
      {
        method: 'GET',
        path: `/sfx-jobs/${JOB_A}`,
        sequence: [
          { data: { status: 'running', error: null, timelineClipId: null, mediaAssetIds: [], seedsUsed: [] } },
          { data: { status: 'succeeded', error: null, timelineClipId: CLIP_A, mediaAssetIds: [ulid('MA1')], seedsUsed: [7] } },
        ],
      },
      { method: 'GET', path: `/sfx-jobs/${JOB_B}`, data: { status: 'failed', error: '効果音を作れませんでした', timelineClipId: null, mediaAssetIds: [], seedsUsed: [] } },
      { method: 'GET', path: `/projects/${PROJECT}/sfx-jobs`, data: [{ id: JOB_A }, { id: JOB_B }] },
    ])
    const outcome = await waitWith(depsFor(fake), {
      projectId: PROJECT,
      jobs: [
        { kind: 'sfx', id: JOB_A },
        { kind: 'sfx', id: JOB_B },
      ],
      maxWaitSec: 60,
    })
    expect(outcome.timedOut).toBe(false)
    expect(outcome.results).toMatchObject([
      { kind: 'sfx', state: 'succeeded', timelineClipId: CLIP_A, seedsUsed: [7] },
      { kind: 'sfx', state: 'failed', error: '効果音を作れませんでした' },
    ])
  })
})
