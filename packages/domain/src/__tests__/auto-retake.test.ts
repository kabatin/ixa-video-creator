import { describe, expect, it } from 'vitest'
import {
  actionAfterReview,
  CreateGenerationJobInput,
  isRetakeRecommended,
  ShotId,
  shouldAutoReview,
  TakeId,
  newId,
} from '../index.js'

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
    expect(isRetakeRecommended({ reviewStatus: 'failed', autoRetake: false }, 'review')).toBe(true)
  })

  it('自動の作り直しを選んだ Take は、作り直しが続いている間は勧めない', () => {
    expect(isRetakeRecommended({ reviewStatus: 'failed', autoRetake: true }, 'generating')).toBe(false)
    expect(isRetakeRecommended({ reviewStatus: 'failed', autoRetake: true }, 'review')).toBe(false)
  })

  /** 上限・予算に触れて自動の作り直しが止まった（Shot が blocked）なら、最後の Take に勧めを残す。 */
  it('自動の作り直しが止まった（Shot が止まった）なら、選んでいても勧める', () => {
    expect(isRetakeRecommended({ reviewStatus: 'failed', autoRetake: true }, 'blocked')).toBe(true)
  })

  it('Shot の状態が分からなければ、選んでいない Take だけ勧める', () => {
    expect(isRetakeRecommended({ reviewStatus: 'failed', autoRetake: false }, null)).toBe(true)
    expect(isRetakeRecommended({ reviewStatus: 'failed', autoRetake: true }, null)).toBe(false)
  })

  it('不合格でなければ勧めない', () => {
    for (const reviewStatus of ['pending', 'passed', 'warned', 'skipped'] as const) {
      expect(isRetakeRecommended({ reviewStatus, autoRetake: false }, 'blocked')).toBe(false)
    }
  })
})

/** 自動の作り直しを選んだ Take は、できたら自動でレビューする（夜間の自走。選んでいなければ人が頼む）。 */
describe('shouldAutoReview', () => {
  it('選んだ Take で、まだレビューしていなければ積む', () => {
    expect(shouldAutoReview({ autoRetake: true, reviewStatus: 'pending', copiedFromTakeId: null })).toBe(true)
  })

  it('選んでいなければ積まない（既定。人が頼む）', () => {
    expect(shouldAutoReview({ autoRetake: false, reviewStatus: 'pending', copiedFromTakeId: null })).toBe(false)
  })

  it('もうレビューした Take は積まない（二重に払わない）', () => {
    for (const reviewStatus of ['passed', 'warned', 'failed', 'skipped'] as const) {
      expect(shouldAutoReview({ autoRetake: true, reviewStatus, copiedFromTakeId: null })).toBe(false)
    }
  })

  it('作品の複製で写した Take は積まない（この作品で作った Take ではない）', () => {
    expect(shouldAutoReview({ autoRetake: true, reviewStatus: 'pending', copiedFromTakeId: newId(TakeId) })).toBe(false)
  })
})
