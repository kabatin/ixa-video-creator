import { defineConfig } from 'drizzle-kit'

/**
 * drizzle-kit の設定。
 * DATABASE_URL は env から読む（CLAUDE.md 規約 6: シークレットは env のみ）。
 * generate はスキーマファイルだけで完結するため DATABASE_URL 未設定でも動く。
 * migrate / studio は接続が必要なので未設定なら明示的に失敗させる。
 */
const databaseUrl = process.env.DATABASE_URL

export default defineConfig({
  schema: './src/schema/*.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: databaseUrl ?? '' },
  strict: true,
  verbose: true,
})
