import { describe, expect, it } from 'vitest'
import { AccessTokenId, newId } from '@ixa/domain'
import { accessTokenRowToDomain, type AccessTokenRow } from '../repositories/access-token-repository.js'

/**
 * 実 DB には接続しない。row → Domain の変換だけを確かめる。
 * 見たいのは **ハッシュが Domain に出ないこと**（Domain の鍵は API の応答にも画面にも流れる）。
 */
const row = (): AccessTokenRow => ({
  id: newId(AccessTokenId),
  kind: 'automation',
  label: 'Claude の MCP',
  tokenHash: 'f'.repeat(64),
  createdAt: new Date('2026-10-09T00:00:00Z'),
  expiresAt: null,
  lastUsedAt: null,
  revokedAt: null,
})

describe('accessTokenRowToDomain', () => {
  it('ハッシュを Domain に出さない', () => {
    const token = accessTokenRowToDomain(row())
    expect(JSON.stringify(token)).not.toContain('f'.repeat(64))
    expect(token).not.toHaveProperty('tokenHash')
  })

  it('種類・名前・期限・取り消しを読む', () => {
    const revokedAt = new Date('2026-10-10T00:00:00Z')
    const token = accessTokenRowToDomain({ ...row(), revokedAt })
    expect(token).toMatchObject({ kind: 'automation', label: 'Claude の MCP', expiresAt: null, revokedAt })
  })
})
