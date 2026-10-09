import { desc, eq } from 'drizzle-orm'
import {
  AccessToken as AccessTokenSchema,
  AccessTokenId as AccessTokenIdSchema,
  newId,
  type AccessToken,
  type AccessTokenId,
  type AccessTokenKind,
} from '@ixa/domain'
import type { DbClient } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { accessTokens } from '../schema/access-token.js'

/** drizzle の row 型。パッケージ外へは出さない（テストだけが使う）。 */
export type AccessTokenRow = typeof accessTokens.$inferSelect

export type CreateAccessTokenInput = {
  readonly kind: AccessTokenKind
  readonly label: string
  /** 鍵の SHA-256。**鍵そのものは渡さない。** */
  readonly tokenHash: string
  readonly expiresAt: Date | null
}

/** API に入るための鍵（認証）。**鍵そのものは扱わない**（ハッシュだけ）。 */
export type AccessTokenRepository = {
  create(input: CreateAccessTokenInput): Promise<AccessToken>
  /** 取り消し済み・期限切れも返す（使えるかの判断は domain の `accessTokenRejection`）。 */
  findByHash(tokenHash: string): Promise<AccessToken | null>
  /** 最後に使った日時を進める。 */
  touch(id: AccessTokenId, at: Date): Promise<void>
  /** 取り消す（行は消さない）。もう取り消してあれば、そのときの日時のまま返す。 */
  revoke(id: AccessTokenId, at: Date): Promise<AccessToken>
  /** 自動化用の鍵（新しい順）。取り消したものも含める（いつ止めたかを画面で見られるように）。 */
  listAutomation(): Promise<AccessToken[]>
}

/** **ハッシュは外へ出さない。** Domain の鍵は「いつ・何の鍵か」だけを持つ。 */
export const accessTokenRowToDomain = (row: AccessTokenRow): AccessToken =>
  AccessTokenSchema.parse({
    id: row.id,
    kind: row.kind,
    label: row.label,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
  })

export const createAccessTokenRepository = (db: DbClient): AccessTokenRepository => ({
  async create(input) {
    const [row] = await db
      .insert(accessTokens)
      .values({
        id: newId(AccessTokenIdSchema),
        kind: input.kind,
        label: input.label,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
      })
      .returning()
    if (row === undefined) throw new Error('鍵を保存できませんでした')
    return accessTokenRowToDomain(row)
  },

  async findByHash(tokenHash) {
    const [row] = await db.select().from(accessTokens).where(eq(accessTokens.tokenHash, tokenHash)).limit(1)
    return row === undefined ? null : accessTokenRowToDomain(row)
  },

  async touch(id, at) {
    await db.update(accessTokens).set({ lastUsedAt: at }).where(eq(accessTokens.id, id))
  },

  async revoke(id, at) {
    const [current] = await db.select().from(accessTokens).where(eq(accessTokens.id, id)).limit(1)
    if (current === undefined) throw new DbNotFoundError('access_tokens', id)
    if (current.revokedAt !== null) return accessTokenRowToDomain(current)
    const [row] = await db
      .update(accessTokens)
      .set({ revokedAt: at })
      .where(eq(accessTokens.id, id))
      .returning()
    if (row === undefined) throw new DbNotFoundError('access_tokens', id)
    return accessTokenRowToDomain(row)
  },

  async listAutomation() {
    const rows = await db
      .select()
      .from(accessTokens)
      .where(eq(accessTokens.kind, 'automation'))
      .orderBy(desc(accessTokens.createdAt))
    return rows.map(accessTokenRowToDomain)
  },
})
