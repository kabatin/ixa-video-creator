import { describe, expect, it } from 'vitest'
import { imageCheckReason, imageJobProgressText, isImageJobActive, WireImageCheck } from '@/lib/image-check'

/** 作った絵のチェック（ADR-0055）の画面の言葉。 */

describe('imageJobProgressText', () => {
  it('作っている・チェックしているを言い分け、やり直しなら回数と上限を添える', () => {
    expect(imageJobProgressText({ status: 'running', attempt: 1 }, 2, '絵コンテの画像')).toBe('絵コンテの画像を作っています')
    expect(imageJobProgressText({ status: 'checking', attempt: 1 }, 2, '絵コンテの画像')).toBe('絵コンテの画像をチェックしています')
    expect(imageJobProgressText({ status: 'queued', attempt: 2 }, 2, '絵コンテの画像')).toBe('やり直し 1/2・絵コンテの画像を作っています')
    expect(imageJobProgressText({ status: 'checking', attempt: 3 }, null, 'キャラクターシート')).toBe(
      'やり直し 2・キャラクターシートをチェックしています',
    )
  })

  it('動いていなければ null', () => {
    expect(imageJobProgressText({ status: 'succeeded', attempt: 2 }, 2, '絵')).toBeNull()
    expect(imageJobProgressText(null, 2, '絵')).toBeNull()
  })
})

describe('isImageJobActive', () => {
  it('チェック中も動いているに数える', () => {
    expect(['queued', 'running', 'checking'].every((status) => isImageJobActive(status as never))).toBe(true)
    expect(['succeeded', 'failed', 'cancelled'].some((status) => isImageJobActive(status as never))).toBe(false)
  })
})

describe('imageCheckReason', () => {
  it('理由をつなぐ。理由が無ければ見ていない理由', () => {
    const base = { mark: 'retry' as const, outcome: 'checked' as const, score: 0.2, note: null }
    expect(
      imageCheckReason({
        ...base,
        issues: [
          { kind: 'anatomy', message: '指が 6 本' },
          { kind: 'text', message: '文字が崩れています' },
        ],
      }),
    ).toBe('指が 6 本 / 文字が崩れています')
    expect(imageCheckReason({ ...base, mark: 'unchecked', outcome: 'skipped', score: null, issues: [], note: '見ていません' })).toBe(
      '見ていません',
    )
    expect(imageCheckReason(null)).toBeNull()
  })

  it('知らない印は読まない', () => {
    expect(WireImageCheck.safeParse({ mark: 'great', outcome: 'checked', score: 1, issues: [], note: null }).success).toBe(false)
  })
})
