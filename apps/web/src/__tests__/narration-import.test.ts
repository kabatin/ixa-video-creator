import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api-error'
import { retryWhileMeasuring } from '@/lib/narration-import'

/**
 * 録音を取り込む（ADR-0038）。上げた直後は音の長さをまだ測っている（409）ので、少し待って頼み直す。
 * ほかの失敗（文字起こしの AI が無い・予算）はすぐ返す（待っても直らない）。
 */

const measuring = () => new ApiError('POST 409', 409, JSON.stringify({ success: false, error: '音の長さをまだ測っています。少し待ってからやり直してください' }))

describe('retryWhileMeasuring', () => {
  it('長さを測っている間は待って頼み直し、通ったらその結果を返す', async () => {
    const run = vi.fn<() => Promise<string>>().mockRejectedValueOnce(measuring()).mockRejectedValueOnce(measuring()).mockResolvedValue('job')
    const sleep = vi.fn(() => Promise.resolve())

    await expect(retryWhileMeasuring(run, { sleep, attempts: 5 })).resolves.toBe('job')
    expect(run).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('ほかの 409（文字起こしの AI が無いなど）は待たずに返す', async () => {
    const other = new ApiError('POST 409', 409, JSON.stringify({ success: false, error: '選んでいる文字起こしの AI は、この環境ではまだ使えません' }))
    const run = vi.fn<() => Promise<string>>().mockRejectedValue(other)

    await expect(retryWhileMeasuring(run, { sleep: () => Promise.resolve(), attempts: 5 })).rejects.toBe(other)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('決めた回数を待っても測り終わらなければ、最後の失敗を返す', async () => {
    const run = vi.fn<() => Promise<string>>().mockRejectedValue(measuring())

    await expect(retryWhileMeasuring(run, { sleep: () => Promise.resolve(), attempts: 3 })).rejects.toBeInstanceOf(ApiError)
    expect(run).toHaveBeenCalledTimes(3)
  })
})
