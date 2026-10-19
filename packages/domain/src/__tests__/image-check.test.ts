import { describe, expect, it } from 'vitest'
import {
  appendRetryDelta,
  IMAGE_CHECK_DEFAULT_MAX_RETRIES,
  ImageCheck,
  ImageCheckId,
  ImageCheckMaxRetries,
  imageCheckMark,
  ImageCheckResult,
  imageCheckViolation,
  ImageGenerationJobId,
  pickImageToApply,
  shouldAutoRetry,
  type ImageChainEntry,
} from '../index.js'

/**
 * 作った画像のチェック・やり直し・当てる絵の選び方（ADR-0055）。
 */

const jobIds = [
  ImageGenerationJobId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA1'),
  ImageGenerationJobId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA2'),
  ImageGenerationJobId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA3'),
] as const

const aCheck = (patch: Partial<ImageCheck> = {}): ImageCheck =>
  ImageCheck.parse({
    id: ImageCheckId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB1'),
    imageJobId: jobIds[0],
    outcome: 'checked',
    verdict: 'pass',
    score: 0.9,
    issues: [],
    promptDelta: null,
    note: null,
    costUsd: 0.01,
    createdAt: new Date('2026-10-19T00:00:00Z'),
    ...patch,
  })

const retry = (score: number): ImageCheck =>
  aCheck({
    verdict: 'retry',
    score,
    issues: [{ kind: 'anatomy', message: '右手の指が 6 本あります' }],
    promptDelta: 'five fingers on each hand',
  })

const skipped = (): ImageCheck =>
  aCheck({ outcome: 'skipped', verdict: null, score: null, note: 'チェックに使える AI が選ばれていません' })

const entry = (index: 0 | 1 | 2, check: ImageCheck | null): ImageChainEntry => ({
  jobId: jobIds[index],
  attempt: index + 1,
  check,
})

describe('チェックの応答（ImageCheckResult）', () => {
  const valid = { verdict: 'pass', score: 0.8, issues: [], promptDelta: null }

  it('形の合う応答は通る', () => {
    expect(ImageCheckResult.parse(valid)).toEqual(valid)
  })

  it('点は 0〜1。外れた値は通さない', () => {
    expect(ImageCheckResult.safeParse({ ...valid, score: 1.01 }).success).toBe(false)
    expect(ImageCheckResult.safeParse({ ...valid, score: -0.01 }).success).toBe(false)
  })

  it('知らない判定・知らない種類は通さない', () => {
    expect(ImageCheckResult.safeParse({ ...valid, verdict: 'fail' }).success).toBe(false)
    expect(
      ImageCheckResult.safeParse({ ...valid, verdict: 'review', issues: [{ kind: 'mood', message: '暗い' }] }).success,
    ).toBe(false)
  })

  it('やり直す判定には理由が要る（理由の無いやり直しで GPU を使わない）', () => {
    expect(ImageCheckResult.safeParse({ ...valid, verdict: 'retry' }).success).toBe(false)
  })

  it('理由と直し方は長すぎない', () => {
    expect(
      ImageCheckResult.safeParse({ ...valid, verdict: 'review', issues: [{ kind: 'text', message: 'あ'.repeat(201) }] }).success,
    ).toBe(false)
    expect(ImageCheckResult.safeParse({ ...valid, promptDelta: 'a'.repeat(501) }).success).toBe(false)
    expect(ImageCheckResult.safeParse({ ...valid, promptDelta: '' }).success).toBe(false)
  })
})

describe('チェックの記録（imageCheckViolation）', () => {
  it('見たなら判定と点がある。飛ばした・落ちたなら判定は無く理由がある', () => {
    expect(imageCheckViolation(aCheck())).toBeNull()
    expect(imageCheckViolation(skipped())).toBeNull()
    expect(imageCheckViolation(aCheck({ verdict: null }))).toMatch(/判定/)
    expect(imageCheckViolation(aCheck({ score: null }))).toMatch(/点/)
    expect(imageCheckViolation(aCheck({ outcome: 'skipped', note: 'x' }))).toMatch(/判定/)
    expect(imageCheckViolation(aCheck({ outcome: 'failed', verdict: null, score: null }))).toMatch(/理由/)
  })

  it('費用は負にならない', () => {
    expect(ImageCheck.safeParse({ ...aCheck(), costUsd: -1 }).success).toBe(false)
  })
})

describe('上限の設定（ImageCheckMaxRetries）', () => {
  it('既定は 2、0〜5 の整数だけ', () => {
    expect(IMAGE_CHECK_DEFAULT_MAX_RETRIES).toBe(2)
    expect(ImageCheckMaxRetries.parse(0)).toBe(0)
    expect(ImageCheckMaxRetries.parse(5)).toBe(5)
    expect(ImageCheckMaxRetries.safeParse(6).success).toBe(false)
    expect(ImageCheckMaxRetries.safeParse(-1).success).toBe(false)
    expect(ImageCheckMaxRetries.safeParse(1.5).success).toBe(false)
  })
})

describe('自動でやり直すか（shouldAutoRetry）', () => {
  const base = { check: retry(0.2), attempt: 1, maxRetries: 2, toolIsLocal: true }

  it('手元の AI で「やり直す」なら、上限まではやり直す', () => {
    expect(shouldAutoRetry(base)).toBe(true)
    expect(shouldAutoRetry({ ...base, attempt: 2 })).toBe(true)
  })

  it('上限に来たら止める（既定 2 回 = 最大 3 枚）', () => {
    expect(shouldAutoRetry({ ...base, attempt: 3 })).toBe(false)
    expect(shouldAutoRetry({ ...base, maxRetries: 0 })).toBe(false)
  })

  it('利用枠を使う AI では自動でやり直さない', () => {
    expect(shouldAutoRetry({ ...base, toolIsLocal: false })).toBe(false)
  })

  it('問題なし・要確認・チェックしていないならやり直さない', () => {
    expect(shouldAutoRetry({ ...base, check: aCheck() })).toBe(false)
    expect(shouldAutoRetry({ ...base, check: aCheck({ verdict: 'review', score: 0.5 }) })).toBe(false)
    expect(shouldAutoRetry({ ...base, check: skipped() })).toBe(false)
    expect(shouldAutoRetry({ ...base, check: null })).toBe(false)
  })
})

describe('当てる絵（pickImageToApply）', () => {
  it('合格したもののうち最新', () => {
    expect(pickImageToApply([entry(0, aCheck()), entry(1, retry(0.9)), entry(2, aCheck({ score: 0.6 }))])).toEqual({
      jobId: jobIds[2],
      needsReview: false,
    })
  })

  it('合格が無ければ点の最も良いものを当て、要確認にする', () => {
    expect(pickImageToApply([entry(0, retry(0.3)), entry(1, retry(0.5)), entry(2, retry(0.4))])).toEqual({
      jobId: jobIds[1],
      needsReview: true,
    })
  })

  it('同じ点なら新しい方', () => {
    expect(pickImageToApply([entry(0, retry(0.5)), entry(1, retry(0.5))])?.jobId).toBe(jobIds[1])
  })

  it('要確認は、点が少し高いやり直しより先に選ぶ', () => {
    expect(pickImageToApply([entry(0, aCheck({ verdict: 'review', score: 0.4 })), entry(1, retry(0.6))])?.jobId).toBe(
      jobIds[0],
    )
  })

  it('チェックしていない絵は、悪いと分かったやり直しより先に選ぶ（要確認の印は付ける）', () => {
    expect(pickImageToApply([entry(0, retry(0.6)), entry(1, skipped())])).toEqual({ jobId: jobIds[1], needsReview: true })
    expect(pickImageToApply([entry(0, null)])).toEqual({ jobId: jobIds[0], needsReview: true })
  })

  it('絵が 1 枚も無ければ何も当てない', () => {
    expect(pickImageToApply([])).toBeNull()
  })

  it('並び順に頼らない（試しの番号で新しさを決める）', () => {
    expect(pickImageToApply([entry(2, aCheck()), entry(0, aCheck())])?.jobId).toBe(jobIds[2])
  })
})

describe('画面の印（imageCheckMark）', () => {
  it('判定をそのまま。見ていなければ unchecked', () => {
    expect(imageCheckMark(aCheck())).toBe('pass')
    expect(imageCheckMark(aCheck({ verdict: 'review' }))).toBe('review')
    expect(imageCheckMark(retry(0.1))).toBe('retry')
    expect(imageCheckMark(skipped())).toBe('unchecked')
    expect(imageCheckMark(null)).toBe('unchecked')
  })
})

describe('やり直しの指示（appendRetryDelta）', () => {
  it('前の絵の直し方を足す。無ければ元のまま', () => {
    expect(appendRetryDelta('a cat', 'five fingers')).toBe('a cat\n\nFix from the previous attempt: five fingers')
    expect(appendRetryDelta('a cat', null)).toBe('a cat')
  })
})
