import { describe, expect, it } from 'vitest'
import { accessTokenRejection } from '../auth/access-token.js'

/** 認証（2026-10-09）。取り消した鍵・期限の切れた鍵で入れないこと。 */
const NOW = new Date('2026-10-09T00:00:00Z')
const later = new Date('2026-10-10T00:00:00Z')
const earlier = new Date('2026-10-08T00:00:00Z')

describe('accessTokenRejection', () => {
  it('期限内で取り消していなければ使える', () => {
    expect(accessTokenRejection({ expiresAt: later, revokedAt: null }, NOW)).toBeNull()
  })

  it('期限の無い鍵（自動化用）は取り消すまで使える', () => {
    expect(accessTokenRejection({ expiresAt: null, revokedAt: null }, NOW)).toBeNull()
  })

  it('取り消した鍵は使えない（期限内でも）', () => {
    expect(accessTokenRejection({ expiresAt: later, revokedAt: earlier }, NOW)).toBe('revoked')
  })

  it('期限が切れた鍵は使えない。ちょうどその時刻も切れている', () => {
    expect(accessTokenRejection({ expiresAt: earlier, revokedAt: null }, NOW)).toBe('expired')
    expect(accessTokenRejection({ expiresAt: NOW, revokedAt: null }, NOW)).toBe('expired')
  })
})
