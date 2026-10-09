import { index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { AccessTokenKind as AccessTokenKindSchema, type AccessTokenKind } from '@ixa/domain'
import { createdAt, timestampTz, ulidPk } from './columns.js'

/**
 * API に入るための鍵（認証）。合言葉で入った端末と、自動化用の鍵（MCP 向け）を同じ表で持つ。
 *
 * **鍵そのものは保存しない。** `token_hash` は鍵の SHA-256。鍵はクッキーか、発行したその場の画面にしか出ない。
 * 鍵は 32 バイトの乱数なので、総当たりで逆算できない（塩は要らない。パスワードとは違う）。
 *
 * ★ 消さない。取り消しは `revoked_at` を入れるだけ（いつ誰の鍵が使われたかを後から追えるように）。
 */
export const accessTokens = pgTable(
  'access_tokens',
  {
    id: ulidPk(),
    kind: text('kind', { enum: AccessTokenKindSchema.options }).$type<AccessTokenKind>().notNull(),
    label: text('label').notNull(),
    tokenHash: text('token_hash').notNull(),
    createdAt: createdAt(),
    expiresAt: timestampTz('expires_at'),
    lastUsedAt: timestampTz('last_used_at'),
    revokedAt: timestampTz('revoked_at'),
  },
  (table) => [
    uniqueIndex('access_tokens_token_hash_idx').on(table.tokenHash),
    index('access_tokens_kind_idx').on(table.kind),
  ],
)
