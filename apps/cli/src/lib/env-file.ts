import { parseEnv } from 'node:util'

/**
 * `.env` を読む（純粋）。値は判定にだけ使い、**表示には名前しか出さない。**
 */

export type EnvValues = Readonly<Record<string, string>>

/** Node の `--env-file` と同じ読み方（api・worker が起動時に読むのと揃える）。 */
export const parseEnvFile = (content: string): EnvValues =>
  Object.fromEntries(
    Object.entries(parseEnv(content)).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )

/** 書いてある変数の名前（`# ` で始まる行は数えない）。 */
export const envKeysOf = (content: string): readonly string[] =>
  content
    .split('\n')
    .map((line) => /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1])
    .filter((key): key is string => key !== undefined)

/** `.env.example` にあって `.env` に無い名前（新しい版で増えた項目）。順番は `.env.example` のまま。 */
export const missingEnvKeys = (exampleContent: string, envContent: string): readonly string[] => {
  const present = new Set(envKeysOf(envContent))
  return [...new Set(envKeysOf(exampleContent))].filter((key) => !present.has(key))
}

/** 空か、書いていないか。 */
export const isBlank = (env: EnvValues, key: string): boolean => (env[key] ?? '').trim() === ''

/**
 * `apps/web/.env.local` が直下の `.env` と違う値で上書きしている名前。
 * Next.js は `apps/web/.env.local` を先に読むので、こちらが勝つ（next.config.mjs）。
 */
export const webLocalOverrides = (rootEnv: EnvValues, webLocal: EnvValues): readonly string[] =>
  Object.keys(webLocal).filter((key) => key in rootEnv && webLocal[key] !== rootEnv[key])

/** 行が無ければ末尾に足す（`fillEmptyEnvValue` は行が無いと何もしないため）。値の入った行は触らない。 */
export const appendEnvLine = (content: string, key: string, value: string): string =>
  `${content}${content.endsWith('\n') || content === '' ? '' : '\n'}${key}=${value}\n`
