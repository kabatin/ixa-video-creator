import { z } from 'zod'
import type { EnvChanges } from './env-merge.js'
import { generatorIdsByEnv, SERVER_REPOS, serverEnvOf, URL_ENV_NAMES } from './servers.js'

/**
 * `tools/ixa-ai/ixa_ai.py` の答えと、`pnpm ixa ai connect` の接続コードを読む（純粋。ADR-0064）。
 * どちらも外から来る文字なので zod で確かめ、`.env` に書く名前と値の形もここで絞る。
 * **失敗の文に値（URL・合言葉・接続コード）を入れない。**
 */

const Fix = z.object({ hint: z.string(), command: z.string().optional(), needsHuman: z.boolean() })

const Component = z.object({
  id: z.string(),
  status: z.string(),
  message: z.string().optional(),
  fix: Fix.optional(),
})
export type AiComponent = z.infer<typeof Component>

export const InstallResult = z.object({
  ok: z.boolean(),
  action: z.literal('install'),
  message: z.string().optional(),
  fix: Fix.optional(),
  servers: z.array(z.object({ server: z.string(), url: z.string(), tokenSet: z.boolean(), components: z.array(Component) })).default([]),
  local: z.array(Component).default([]),
  env: z.record(z.string()).default({}),
})
export type InstallResult = z.infer<typeof InstallResult>

/** `.env` に 1 行で書いて崩れない値（空白・改行・`#`・引用符を含まない）。 */
const SAFE_VALUE = /^[^\s#"'`]+$/

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const valueProblem = (key: string, value: string): string | null => {
  if (!SAFE_VALUE.test(value)) return `${key} の値の形が違います`
  const generatorIds = generatorIdsByEnv().get(key)
  if (generatorIds !== undefined) {
    return value.split(',').every((id) => generatorIds.includes(id)) ? null : `${key} に知らない値があります`
  }
  if (URL_ENV_NAMES.includes(key)) return isHttpUrl(value) ? null : `${key} が http(s) の URL ではありません`
  if (key === 'WHISPER_CPP_MODEL') return value.startsWith('/') ? null : `${key} が絶対パスではありません`
  return `${key} は ixa_ai.py が書いてよい名前ではありません`
}

/** ixa_ai.py の `env` を確かめる（合言葉はここに来ない。来たら止める）。 */
export const validateInstallEnv = (env: Readonly<Record<string, string>>): EnvChanges => {
  const problems = Object.entries(env)
    .map(([key, value]) => valueProblem(key, value))
    .filter((problem): problem is string => problem !== null)
  if (problems.length > 0) throw new Error(`ixa_ai.py の答えを .env に書けません: ${problems.join('／')}`)
  return env
}

const ConnectCode = z.object({
  v: z.literal(1),
  servers: z
    .array(
      z.object({
        id: z.enum(SERVER_REPOS),
        // new URL() は改行・タブを黙って落とすので、URL として読める前に 1 行で書ける形かを見る。
        url: z.string().regex(SAFE_VALUE).refine(isHttpUrl),
        token: z.string().regex(SAFE_VALUE),
      }),
    )
    .min(1),
})

const decodeBase64Url = (code: string): unknown => {
  try {
    return JSON.parse(Buffer.from(code.trim(), 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

/**
 * 接続コード（別の Mac の `ixa_ai.py install --lan` が出す 1 行）を `.env` の変更にする。
 * 合言葉の形（32 文字以上など）は、書いたあとの `configProblems` が確かめる（規則を写さない）。
 */
export const connectCodeChanges = (code: string): EnvChanges => {
  const parsed = ConnectCode.safeParse(decodeBase64Url(code))
  if (!parsed.success) throw new Error('接続コードを読めません（別の Mac に出た 1 行をそのまま貼ってください）')
  return parsed.data.servers.reduce<EnvChanges>((acc, server) => {
    const env = serverEnvOf(server.id)
    const current = acc[env.enabledBy]
    return {
      ...acc,
      [env.enabledBy]: current === undefined ? env.id : `${current},${env.id}`,
      [env.urlEnvName]: server.url,
      [env.tokenEnvName]: server.token,
    }
  }, {})
}
