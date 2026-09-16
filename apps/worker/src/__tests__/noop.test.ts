import { describe, expect, it } from 'vitest'
import { processNoopJob, type NoopJobData } from '../processors/noop.js'

describe('processNoopJob', () => {
  it('入力メッセージをそのままエコーする', async () => {
    const result = await processNoopJob({ message: 'ping' })

    expect(result.echoed).toBe('ping')
    expect(typeof result.processedAt).toBe('string')
    expect(new Date(result.processedAt).toString()).not.toBe('Invalid Date')
  })

  it('不正な入力（空文字の message）は throw する', async () => {
    await expect(processNoopJob({ message: '' })).rejects.toThrow()
  })

  it('不正な入力（message が欠落）は throw する', async () => {
    await expect(processNoopJob({} as unknown as NoopJobData)).rejects.toThrow()
  })

  it('不正な入力（message が文字列でない）は throw する', async () => {
    await expect(processNoopJob({ message: 123 } as unknown as NoopJobData)).rejects.toThrow()
  })
})
