import {
  INSPECT_FORMAT,
  PUBLISHER_FORMAT,
  composeSettingsOf,
  containerInfoOf,
  loopbackPortOf,
  publishersOf,
  type ContainerInfo,
} from '../lib/compose.js'
import type { EnvValues } from '../lib/env-file.js'
import type { System } from '../system.js'
import type { Fix } from '../types.js'

/** Docker のコンテナを調べる口（doctor と setup の見張りが使う）。 */

/** 別の clone のコンテナを見つけたときの直し方（分けるか共有するかは人が決める）。 */
export const FOREIGN_INFRA_FIX: Fix = {
  hint:
    '分けるなら .env に IXA_COMPOSE_PROJECT・IXA_COMPOSE_PREFIX・POSTGRES_PORT・REDIS_PORT を書き、DATABASE_URL・REDIS_URL のポートも揃える。' +
    '共有してよいなら IXA_COMPOSE_SHARED=true。どちらにするか制作者に聞く',
  needsHuman: true,
}

export const inspectContainer = async (system: System, name: string): Promise<ContainerInfo> => {
  const result = await system.run('docker', ['inspect', '-f', INSPECT_FORMAT, name], { timeoutMs: 10_000 })
  return containerInfoOf(result.kind === 'completed' ? result : null)
}

const publishersOnPort = async (system: System, port: number | null): Promise<readonly ContainerInfo[]> => {
  if (port === null) return []
  const result = await system.run('docker', ['ps', '--filter', `publish=${String(port)}`, '--format', PUBLISHER_FORMAT], {
    timeoutMs: 10_000,
  })
  return result.kind === 'completed' && result.exitCode === 0 ? publishersOf(result.stdout) : []
}

const withRealDir = async (system: System, info: ContainerInfo): Promise<ContainerInfo> =>
  info.composeDir === null ? info : { ...info, composeDir: await system.realpath(info.composeDir) }

/** 名前とポートで見つかったコンテナ（場所はたどったもの）。 */
export const infraInfos = async (system: System, env: EnvValues): Promise<readonly ContainerInfo[]> => {
  const compose = composeSettingsOf(env)
  const found = await Promise.all([
    inspectContainer(system, compose.postgresContainer).then((i) => [i]),
    inspectContainer(system, compose.redisContainer).then((i) => [i]),
    publishersOnPort(system, loopbackPortOf(env['DATABASE_URL'] ?? '', 5432)),
    publishersOnPort(system, loopbackPortOf(env['REDIS_URL'] ?? '', 6379)),
  ])
  return Promise.all(found.flat().map((info) => withRealDir(system, info)))
}

