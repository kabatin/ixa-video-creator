import { describe, expect, it } from 'vitest'
import { analyzeMotionTool } from '../tools/motion.js'
import { generateSfxTool, suggestSfxTool } from '../tools/sfx.js'
import { createFakeApi, depsFor, jsonOf, textOf, ulid } from './fake-api.js'

/** 動きの分析（ADR-0054）。積んで、終わるまで待ち、出来事と効果音のきっかけの案を返す。 */

const SHOT = ulid('SH1')
const TAKE = ulid('TK1')

const shotBody = (state: string) => ({
  shotId: SHOT,
  takeId: TAKE,
  state,
  failureMessage: state === 'failed' ? '動画から動きを測れませんでした。' : null,
  visionUsed: state === 'succeeded' ? true : null,
  analyzedAt: null,
  energy: null,
  onsets: state === 'succeeded' ? [{ atSec: 24.72, strength: 1 }] : [],
  events:
    state === 'succeeded'
      ? [{ kind: 'moment', startSec: 24.72, durationSec: 0.4, label: '着地', sfxPrompt: 'soft footstep', confidence: 0.9 }]
      : [],
  suggestions:
    state === 'succeeded'
      ? [{ kind: 'motion_moment', reason: '動き: 着地', cue: { startSec: 24.72, durationSec: 0.5, prompt: 'soft footstep', volume: 0.8 } }]
      : [],
})

describe('analyze_motion', () => {
  it('Shot を積み、終わるまで待って、出来事ときっかけを返す', async () => {
    const fake = createFakeApi([
      { method: 'POST', path: `/shots/${SHOT}/motion-analysis`, status: 202, data: { state: 'queued' } },
      {
        method: 'GET',
        path: `/shots/${SHOT}/motion-analysis`,
        sequence: [{ data: shotBody('queued') }, { data: shotBody('running') }, { data: shotBody('succeeded') }],
      },
    ])
    const result = jsonOf(await analyzeMotionTool.run({ shotId: SHOT }, depsFor(fake))) as {
      state: string
      events: unknown[]
      cues: { startSec: number }[]
      timedOut: boolean
    }
    expect(fake.callsTo('POST', `/shots/${SHOT}/motion-analysis`)).toHaveLength(1)
    expect(result.state).toBe('succeeded')
    expect(result.timedOut).toBe(false)
    expect(result.events).toHaveLength(1)
    expect(result.cues).toEqual([{ startSec: 24.72, durationSec: 0.5, prompt: 'soft footstep', volume: 0.8 }])
  })

  it('Take を渡せば Take の口を使う', async () => {
    const fake = createFakeApi([
      { method: 'POST', path: `/takes/${TAKE}/motion-analysis`, status: 202, data: { state: 'queued' } },
      {
        method: 'GET',
        path: `/takes/${TAKE}/motion-analysis`,
        data: { takeId: TAKE, state: 'succeeded', failureMessage: null, analysis: null },
      },
    ])
    const result = jsonOf(await analyzeMotionTool.run({ takeId: TAKE }, depsFor(fake))) as { state: string }
    expect(result.state).toBe('succeeded')
  })

  it('失敗なら理由を返す', async () => {
    const fake = createFakeApi([
      { method: 'POST', path: `/shots/${SHOT}/motion-analysis`, status: 202, data: { state: 'queued' } },
      { method: 'GET', path: `/shots/${SHOT}/motion-analysis`, data: shotBody('failed') },
    ])
    const result = jsonOf(await analyzeMotionTool.run({ shotId: SHOT }, depsFor(fake))) as { failureMessage: string }
    expect(result.failureMessage).toContain('動き')
  })

  it('待ち切れなければ timedOut で返し、もう一度呼ぶよう言う', async () => {
    const fake = createFakeApi([
      { method: 'POST', path: `/shots/${SHOT}/motion-analysis`, status: 202, data: { state: 'queued' } },
      { method: 'GET', path: `/shots/${SHOT}/motion-analysis`, data: shotBody('running') },
    ])
    const result = jsonOf(await analyzeMotionTool.run({ shotId: SHOT, maxWaitSec: 10 }, depsFor(fake))) as {
      timedOut: boolean
      hint: string
    }
    expect(result.timedOut).toBe(true)
    expect(result.hint).toMatch(/analyze_motion again/)
  })

  it('Shot と Take の両方・どちらも無い入力は断る', async () => {
    const fake = createFakeApi([])
    expect(textOf(await analyzeMotionTool.run({ shotId: SHOT, takeId: TAKE }, depsFor(fake)))).toMatch(/shotId か takeId/)
    expect(textOf(await analyzeMotionTool.run({}, depsFor(fake)))).toMatch(/shotId か takeId/)
  })
})

describe('効果音のツールの説明', () => {
  it('generate_sfx は「分析 → 案を直す → 頼む」の順を言う', () => {
    expect(generateSfxTool.description).toMatch(/analyze_motion/)
  })

  it('suggest_sfx は分析済みの Shot の動きも混ぜると言う', () => {
    expect(suggestSfxTool.description).toMatch(/analyze_motion/)
  })
})

describe('山で合わせる印（ADR-0054 追記）', () => {
  it('suggest_sfx は案の印をそのまま返し、generate_sfx は印をそのまま送る', async () => {
    const PROJECT = ulid('PJ1')
    const aligned = { startSec: 24.14, durationSec: 0.5, prompt: 'soft footstep', volume: 0.8, align: { to: 'peak', notBeforeSec: 22.22 } }
    const fake = createFakeApi([
      { method: 'GET', path: `/projects/${PROJECT}/sfx/suggestions`, data: [{ kind: 'motion_moment', reason: '動き: 着地', cue: aligned }] },
      { method: 'POST', path: `/projects/${PROJECT}/sfx/generate`, status: 202, data: { jobIds: [ulid('SJA')] } },
    ])
    const suggested = jsonOf(await suggestSfxTool.run({ projectId: PROJECT }, depsFor(fake))) as { cues: unknown[] }
    expect(suggested.cues).toEqual([aligned])
    await generateSfxTool.run({ projectId: PROJECT, cues: suggested.cues }, depsFor(fake))
    expect(fake.callsTo('POST', `/projects/${PROJECT}/sfx/generate`)[0]?.body).toMatchObject({ cues: [aligned] })
  })

  it('generate_sfx の説明は、印を消さずに渡すよう言う', () => {
    expect(generateSfxTool.description).toMatch(/align/)
  })
})
