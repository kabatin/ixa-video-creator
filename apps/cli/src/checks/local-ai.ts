import { EnvSchema, LOCAL_VIDEO_SERVERS } from '@ixa/config'
import type { EnvValues } from '../lib/env-file.js'
import type { System } from '../system.js'
import type { CheckResult } from '../types.js'

/**
 * 手元の AI サーバー（vpipe・wan・klein・ace-step・sfx）。**`.env` で有効にしたものだけ**届くかを見る。
 * 叩くのは `GET /v1/health` だけ（何も積まない。`packages/providers` の点検と同じ口）。
 * サーバそのものの導入は `pnpm ixa ai install`（ADR-0064）。ここは届くかを見るだけ。
 */

export type LocalServerFacts = {
  readonly id: string
  readonly enabledBy: string
  readonly urlEnvName: string
  /** 届いたら true、届かなければ理由。 */
  readonly reachable: true | string
}

export type LocalAiFacts = { readonly configValid: boolean; readonly servers: readonly LocalServerFacts[] }

const DOCS = 'INSTALL.md#手元の生成-ai'

/** 判定（純粋）。 */
export const judgeLocalAi = (facts: LocalAiFacts): readonly CheckResult[] => {
  if (!facts.configValid) {
    return [{ id: 'local-ai', group: 'local-ai', level: 'skip', message: '設定が揃っていないので見ません（上の「設定」の項目）' }]
  }
  if (facts.servers.length === 0) {
    return [{ id: 'local-ai', group: 'local-ai', level: 'ok', message: '手元の AI サーバーは使わない設定です' }]
  }
  return facts.servers.map((server) =>
    server.reachable === true
      ? { id: `local-ai.${server.id}`, group: 'local-ai', level: 'ok', message: `${server.id} に届きます` }
      : {
          id: `local-ai.${server.id}`,
          group: 'local-ai',
          level: 'warn',
          message: `${server.enabledBy} に ${server.id} があるが届きません（${server.reachable}）`,
          fix: {
            hint:
              `この Mac に入れるなら pnpm ixa ai install。別の Mac なら、その Mac で ixa_ai.py install --lan を回し、` +
              `出た pnpm ixa ai connect … を貼る（INSTALL.md）。入っているならサーバを起動するか ${server.urlEnvName} を確かめる`,
            command: 'pnpm ixa ai install',
            needsHuman: true,
          },
          docs: DOCS,
        },
  )
}

const reach = async (system: System, baseUrl: string, token: string | undefined): Promise<true | string> => {
  const response = await system.httpGet(
    `${baseUrl.replace(/\/+$/, '')}/v1/health`,
    5000,
    token === undefined ? {} : { authorization: `Bearer ${token}` },
  )
  if (!response.ok) return response.reason
  if (response.status === 401 || response.status === 403) return 'トークンが合いません'
  return response.status === 200 ? true : `応答が異常です（${String(response.status)}）`
}

export const gatherLocalAi = async (system: System, env: EnvValues): Promise<LocalAiFacts> => {
  const parsed = EnvSchema.safeParse(env)
  if (!parsed.success) return { configValid: false, servers: [] }
  const config = parsed.data
  const enabled = LOCAL_VIDEO_SERVERS.filter((server) => (config[server.enabledBy] as readonly string[]).includes(server.id))
  const servers = await Promise.all(
    enabled.map(async (server) => ({
      id: server.id,
      enabledBy: server.enabledBy,
      urlEnvName: server.urlEnvName,
      reachable: await reach(system, config[server.urlEnvName], config[server.tokenEnvName]),
    })),
  )
  return { configValid: true, servers }
}
