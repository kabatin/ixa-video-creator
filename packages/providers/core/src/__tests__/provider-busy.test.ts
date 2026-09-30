import { ProviderId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { ProviderBusyError, ProviderError } from '../provider.js'

const PROVIDER_ID = ProviderId.parse('vpipe')

/**
 * 「満杯なので後で来て」（ADR-0030）。投入前の断りなので、終端の失敗と取り違えないこと。
 */
describe('ProviderBusyError', () => {
  it('ProviderError の一種で、常にやり直せる', () => {
    const error = new ProviderBusyError('満杯', PROVIDER_ID, 30_000)

    expect(error).toBeInstanceOf(ProviderError)
    expect(error).toBeInstanceOf(ProviderBusyError)
    expect(error.retryable).toBe(true)
    expect(error.providerId).toBe(PROVIDER_ID)
    expect(error.name).toBe('ProviderBusyError')
  })

  it('待ち時間を運ぶ。示されなければ null', () => {
    expect(new ProviderBusyError('満杯', PROVIDER_ID, 45_000).retryAfterMs).toBe(45_000)
    expect(new ProviderBusyError('満杯', PROVIDER_ID, null).retryAfterMs).toBeNull()
  })

  it('普通の ProviderError は ProviderBusyError ではない（取り違えて待ち続けない）', () => {
    expect(new ProviderError('壊れた', PROVIDER_ID, true)).not.toBeInstanceOf(ProviderBusyError)
  })
})
