import { describe, expect, it } from 'vitest'
import { actionAfterReview, CreateGenerationJobInput, isRetakeRecommended, ShotId, TakeId, newId } from '../index.js'

/**
 * 動画の Take が NG のときに自動で作り直すか（制作者の要望 2026-10-23。レビューと作り直しは時間とトークンを多く使う）。
 * **既定は作り直さず、作り直しを勧めるだけ。** 生成を頼むときに選んだときだけ、今までどおり上限つきで作り直す。
 */

describe('actionAfterReview', () => {
  it('NG で、頼むときに自動の作り直しを選んでいれば作り直す', () => {
    expect(actionAfterReview({ verdict: 'fail', autoRetake: true })).toBe('regenerate')
  })

  it('NG でも、選んでいなければ作り直しを勧めるだけ（既定）', () => {
    expect(actionAfterReview({ verdict: 'fail', autoRetake: false })).toBe('recommend')
  })

  it('合格・警告・判定なしなら何もしない（警告は人が見る）', () => {
    for (const autoRetake of [true, false]) {
      expect(actionAfterReview({ verdict: 'pass', autoRetake })).toBe('none')
      expect(actionAfterReview({ verdict: 'warn', autoRetake })).toBe('none')
      expect(actionAfterReview({ verdict: null, autoRetake })).toBe('none')
    }
  })
})

describe('GenerationJob の自動の作り直し', () => {
  const base = { shotId: newId(ShotId), specHash: 'a'.repeat(64), requestedModel: 'AUTO' as const }

  it('省けば作り直さない（既定）', () => {
    expect(CreateGenerationJobInput.parse(base).autoRetake).toBe(false)
  })

  it('選べば true を残す。真偽値以外は受けない', () => {
    expect(CreateGenerationJobInput.parse({ ...base, autoRetake: true }).autoRetake).toBe(true)
    expect(CreateGenerationJobInput.safeParse({ ...base, autoRetake: 'yes' }).success).toBe(false)
  })

  it('作り直しのジョブも、系譜と一緒に旗を持てる', () => {
    const parsed = CreateGenerationJobInput.parse({
      ...base,
      parentTakeId: newId(TakeId),
      regenerationReason: 'identity: 顔が違う',
      autoRetake: true,
    })
    expect(parsed.autoRetake).toBe(true)
  })
})

describe('isRetakeRecommended', () => {
  it('レビューが不合格で、自動の作り直しを選んでいない Take は「作り直し推奨」', () => {
    expect(isRetakeRecommended({ reviewStatus: 'failed', autoRetake: false })).toBe(true)
  })

  it('自動の作り直しを選んだ Take は、作り直しが走るので勧めない', () => {
    expect(isRetakeRecommended({ reviewStatus: 'failed', autoRetake: true })).toBe(false)
  })

  it('不合格でなければ勧めない', () => {
    for (const reviewStatus of ['pending', 'passed', 'warned', 'skipped'] as const) {
      expect(isRetakeRecommended({ reviewStatus, autoRetake: false })).toBe(false)
    }
  })
})
