import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'drizzle-kit'

/**
 * drizzle-kit の設定。
 * DATABASE_URL は env から読む（CLAUDE.md 規約 6: シークレットは env のみ）。
 * generate はスキーマファイルだけで完結するため DATABASE_URL 未設定でも動く。
 * migrate / studio は接続が必要なので未設定なら明示的に失敗させる。
 *
 * **リポジトリ直下の `.env` を読む。** `pnpm db:migrate` はこのパッケージの中で走るので、
 * 読まないと README の手順どおり `cp .env.example .env` しても DATABASE_URL が空になり、
 * まっさらな clone では必ず失敗していた（api / worker は `--env-file=../../.env` で読んでいる）。
 * すでに環境にある値は上書きしない（CI やシェルで渡した値が勝つ）。
 *
 * 起点は作業ディレクトリ（`pnpm --filter @ixa/db` は必ずこのパッケージの中で走る）。
 * `import.meta.dirname` は使えない。drizzle-kit がこのファイルを CJS に変換して読むため、
 * undefined になって落ちる（実際に落ちた）。
 */
const rootEnv = resolve(process.cwd(), '../../.env')
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv)

const databaseUrl = process.env.DATABASE_URL

export default defineConfig({
  schema: './src/schema/*.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: databaseUrl ?? '' },
  strict: true,
  verbose: true,
})
