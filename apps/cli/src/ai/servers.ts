import { LOCAL_VIDEO_SERVERS } from '@ixa/config'

/**
 * 手元の AI サーバーのリポジトリ名（`tools/ixa-ai/catalog.json` の `servers` の鍵）と、
 * ixa の `.env` の名前の対応（ADR-0064）。`.env` の名前は `LOCAL_VIDEO_SERVERS` が唯一の正で、ここは名前を引くだけ。
 */

export const SERVER_REPOS = ['vpipe-api', 'wan-api', 'klein-api', 'ace-step-api', 'sfx-api'] as const
export type ServerRepo = (typeof SERVER_REPOS)[number]

const REPO_TO_ID: Readonly<Record<ServerRepo, string>> = {
  'vpipe-api': 'vpipe',
  'wan-api': 'wan',
  'klein-api': 'klein',
  'ace-step-api': 'ace_step',
  'sfx-api': 'sfx_api',
}

export type LocalServerEnv = (typeof LOCAL_VIDEO_SERVERS)[number]

export const serverEnvOf = (repo: ServerRepo): LocalServerEnv => {
  const found = LOCAL_VIDEO_SERVERS.find((server) => server.id === REPO_TO_ID[repo])
  if (found === undefined) throw new Error(`${repo} の .env の名前が見つかりません（LOCAL_VIDEO_SERVERS）`)
  return found
}

/** `LOCAL_*_GENERATOR` に書いてよい値（名前ごと）。 */
export const generatorIdsByEnv = (): ReadonlyMap<string, readonly string[]> =>
  LOCAL_VIDEO_SERVERS.reduce(
    (map, server) => new Map([...map, [server.enabledBy, [...(map.get(server.enabledBy) ?? []), server.id]]]),
    new Map<string, readonly string[]>(),
  )

export const URL_ENV_NAMES: readonly string[] = LOCAL_VIDEO_SERVERS.map((server) => server.urlEnvName)
export const TOKEN_ENV_NAMES: readonly string[] = LOCAL_VIDEO_SERVERS.map((server) => server.tokenEnvName)

/** 値の入っていない扱いにしてよい URL（その名前の既定。`.env.example` にもこの値が入っている）。 */
export const defaultUrlOf = (urlEnvName: string): string | undefined =>
  LOCAL_VIDEO_SERVERS.find((server) => server.urlEnvName === urlEnvName)?.defaultUrl

/** 合言葉の名前と対になる URL の名前。 */
export const urlEnvOfToken = (tokenEnvName: string): string | undefined =>
  LOCAL_VIDEO_SERVERS.find((server) => server.tokenEnvName === tokenEnvName)?.urlEnvName
