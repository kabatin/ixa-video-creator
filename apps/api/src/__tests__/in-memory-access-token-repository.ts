import type { AccessTokenRepository, CreateAccessTokenInput } from '@ixa/db'
import { DbNotFoundError } from '@ixa/db'
import { AccessTokenId, newId, type AccessToken } from '@ixa/domain'

/** 鍵の表のテストダブル。**ハッシュも覚える**（鍵そのものが入っていないかを確かめるため）。 */
export type InMemoryAccessTokens = AccessTokenRepository & {
  readonly rows: () => readonly (AccessToken & { readonly tokenHash: string })[]
}

export const createInMemoryAccessTokens = (): InMemoryAccessTokens => {
  let rows: readonly (AccessToken & { readonly tokenHash: string })[] = []
  /** 表の外へはハッシュを出さない（本物の `accessTokenRowToDomain` と同じ）。 */
  const strip = (row: AccessToken & { readonly tokenHash: string }): AccessToken => ({
    id: row.id,
    kind: row.kind,
    label: row.label,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
  })
  const replace = (id: AccessToken['id'], patch: Partial<AccessToken>) => {
    rows = rows.map((row) => (row.id === id ? { ...row, ...patch } : row))
  }
  return {
    rows: () => rows,
    create: (input: CreateAccessTokenInput) => {
      const row = {
        id: newId(AccessTokenId),
        kind: input.kind,
        label: input.label,
        tokenHash: input.tokenHash,
        createdAt: new Date(),
        expiresAt: input.expiresAt,
        lastUsedAt: null,
        revokedAt: null,
      }
      rows = [...rows, row]
      return Promise.resolve(strip(row))
    },
    findByHash: (hash) => {
      const row = rows.find((r) => r.tokenHash === hash)
      return Promise.resolve(row === undefined ? null : strip(row))
    },
    touch: (id, at) => {
      replace(id, { lastUsedAt: at })
      return Promise.resolve()
    },
    revoke: (id, at) => {
      const row = rows.find((r) => r.id === id)
      if (row === undefined) return Promise.reject(new DbNotFoundError('access_tokens', id))
      if (row.revokedAt === null) replace(id, { revokedAt: at })
      const updated = rows.find((r) => r.id === id)
      return Promise.resolve(strip(updated ?? row))
    },
    listAutomation: () =>
      Promise.resolve(rows.filter((r) => r.kind === 'automation').map(strip).reverse()),
  }
}
