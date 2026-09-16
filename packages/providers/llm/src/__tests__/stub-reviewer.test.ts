import { LLM_REVIEWERS } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { UnsupportedReviewerError } from '../errors.js'
import {
  canonicalizeReviewRequest,
  createStubVisionReviewer,
  digestReviewRequest,
  frameSecFromLabel,
  scoreFromDigest,
  severityForScore,
  stubReviewResult,
  STUB_VISION_REVIEWER_NAME,
} from '../stub-reviewer.js'
import { makeReviewRequest } from './fixtures.js'

describe('スタブ vision レビュアの決定性', () => {
  it('同じ入力なら別インスタンスでも完全に同じ結果を返す', async () => {
    const request = makeReviewRequest()
    const first = await createStubVisionReviewer().review(request)
    const second = await createStubVisionReviewer().review(request)

    expect(first).toEqual(second)
  })

  it('URL が変わっても結果は変わらない（署名付き URL は都度発行されるため）', async () => {
    const base = makeReviewRequest()
    const reissued = makeReviewRequest({
      subjects: [{ label: 'frame@1.5s', url: 'https://example.test/frames/a.png?sig=ZZZ&expires=9' }],
      references: [
        { label: 'reference:face_front', url: 'https://example.test/refs/face.png?sig=YYY&expires=9' },
      ],
    })

    const reviewer = createStubVisionReviewer()
    expect(await reviewer.review(base)).toEqual(await reviewer.review(reissued))
  })

  it('正規化文字列に URL を含めない', () => {
    expect(canonicalizeReviewRequest(makeReviewRequest())).not.toContain('sig=')
  })

  it('reviewer / criteria / ラベルが変われば結果も変わる', () => {
    const base = makeReviewRequest()
    const digests = [
      digestReviewRequest(base),
      digestReviewRequest(makeReviewRequest({ reviewer: 'composition' })),
      digestReviewRequest(makeReviewRequest({ criteria: '別の基準' })),
      digestReviewRequest(makeReviewRequest({ subjects: [{ label: 'frame@9s', url: 'u' }] })),
    ]

    expect(new Set(digests).size).toBe(4)
  })

  it('score はダイジェストから計算でき、テストが期待値を書ける', () => {
    const request = makeReviewRequest()
    const expected = scoreFromDigest(digestReviewRequest(request))

    expect(stubReviewResult(request).score).toBe(expected)
    expect(expected).toBeGreaterThanOrEqual(0)
    expect(expected).toBeLessThanOrEqual(1)
  })

  it('乱数も時刻も使わないので 50 回呼んでも同一', async () => {
    const reviewer = createStubVisionReviewer()
    const request = makeReviewRequest()
    const first = await reviewer.review(request)

    for (let i = 0; i < 50; i += 1) {
      expect(await reviewer.review(request)).toEqual(first)
    }
  })
})

describe('スタブ vision レビュアの判定内容', () => {
  it('costUsd は常に 0（実際に払っていないため）', async () => {
    const outcome = await createStubVisionReviewer().review(makeReviewRequest())
    expect(outcome.costUsd).toBe(0)
  })

  it('severity は必ず score と整合する', () => {
    for (const reviewer of LLM_REVIEWERS) {
      for (const outcome of ['auto', 'info', 'warn', 'fail'] as const) {
        const result = stubReviewResult(makeReviewRequest({ reviewer }), outcome)
        expect(severityForScore(result.score)).toBe(result.severity)
      }
    }
  })

  it('outcome で意図的に fail を返させられる（fail 経路を試すため）', async () => {
    const reviewer = createStubVisionReviewer({ outcome: 'fail' })
    const { result } = await reviewer.review(makeReviewRequest())

    expect(result.severity).toBe('fail')
    expect(result.score).toBeLessThan(0.5)
    expect(result.suggestedPromptDelta).not.toBeNull()
  })

  it('outcome を強制しても score は入力依存のまま', () => {
    const a = stubReviewResult(makeReviewRequest(), 'fail')
    const b = stubReviewResult(makeReviewRequest({ criteria: '別の基準' }), 'fail')

    expect(a.severity).toBe('fail')
    expect(b.severity).toBe('fail')
    expect(a.score).not.toBe(b.score)
  })

  it('info のときは suggestedPromptDelta が null（直す点が無い）', () => {
    const result = stubReviewResult(makeReviewRequest(), 'info')

    expect(result.severity).toBe('info')
    expect(result.suggestedPromptDelta).toBeNull()
  })

  it('warn / fail の差分は具体的で、参照ラベルを含む', () => {
    const result = stubReviewResult(makeReviewRequest(), 'warn')

    expect(result.suggestedPromptDelta).toContain('reference:face_front')
    expect(result.suggestedPromptDelta).not.toContain('頑張')
  })

  it('frameSec をラベルから決定的に読む', () => {
    expect(frameSecFromLabel('frame@1.5s')).toBe(1.5)
    expect(frameSecFromLabel('frame@12s')).toBe(12)
    expect(frameSecFromLabel('reference:face_front')).toBeNull()
    expect(stubReviewResult(makeReviewRequest()).frameSec).toBe(1.5)
    expect(
      stubReviewResult(makeReviewRequest({ subjects: [{ label: 'poster', url: 'u' }] })).frameSec,
    ).toBeNull()
  })
})

describe('スタブ vision レビュアの境界', () => {
  it('既定では LLM 判定が要るレビュアだけを受け持つ', () => {
    expect([...createStubVisionReviewer().supports]).toEqual([...LLM_REVIEWERS])
    expect(createStubVisionReviewer().name).toBe(STUB_VISION_REVIEWER_NAME)
  })

  it('対応外のレビュア種別は同期 throw ではなく reject で返す', async () => {
    const promise = createStubVisionReviewer().review(makeReviewRequest({ reviewer: 'technical' }))

    await expect(promise).rejects.toBeInstanceOf(UnsupportedReviewerError)
    await expect(promise).rejects.toMatchObject({ code: 'unsupported_reviewer', retryable: false })
  })

  it('不正な判定依頼は検証で弾く', async () => {
    await expect(
      createStubVisionReviewer().review(makeReviewRequest({ subjects: [] })),
    ).rejects.toThrow()
    await expect(
      createStubVisionReviewer().review(makeReviewRequest({ criteria: '' })),
    ).rejects.toThrow()
  })

  it('不正な設定は生成時点で弾く', () => {
    expect(() => createStubVisionReviewer({ name: '' })).toThrow()
    expect(() => createStubVisionReviewer({ supports: [] })).toThrow()
  })

  it('入力を破壊的に変更しない', async () => {
    const request = makeReviewRequest()
    const snapshot = structuredClone(request)
    await createStubVisionReviewer().review(request)

    expect(request).toEqual(snapshot)
  })
})
