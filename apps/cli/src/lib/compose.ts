import type { EnvValues } from './env-file.js'
import type { RepoPaths } from './repo.js'

/**
 * Docker（postgres・redis）の名前（純粋）。既定は `pnpm infra:up` と同じ
 * （プロジェクト `infra`・`ixa-postgres`・`ixa-redis`）。2 つ目の clone だけ `.env` で替える（ADR-0063）。
 */

const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/

const nameOr = (value: string | undefined, fallback: string): string => {
  const trimmed = (value ?? '').trim()
  return NAME_PATTERN.test(trimmed) ? trimmed : fallback
}

export type ComposeSettings = {
  readonly project: string
  readonly postgresContainer: string
  readonly redisContainer: string
}

export const composeSettingsOf = (env: EnvValues): ComposeSettings => {
  const prefix = nameOr(env['IXA_COMPOSE_PREFIX'], 'ixa')
  return {
    project: nameOr(env['IXA_COMPOSE_PROJECT'], 'infra'),
    postgresContainer: `${prefix}-postgres`,
    redisContainer: `${prefix}-redis`,
  }
}

/** `docker compose … up -d` の引数。`.env` を渡すのでポートと名前は compose 側で決まる。 */
export const composeUpArgs = (settings: ComposeSettings, repo: RepoPaths): readonly string[] => [
  'compose',
  '-p',
  settings.project,
  '--env-file',
  repo.env,
  '-f',
  repo.compose,
  'up',
  '-d',
]

/** 打てる形の 1 行（直し方に出す）。直下で打つ前提の相対パス。 */
export const composeUpCommand = (settings: ComposeSettings): string =>
  settings.project === 'infra'
    ? 'pnpm infra:up'
    : `docker compose -p ${settings.project} --env-file .env -f infra/docker-compose.yml up -d`

/** `docker inspect` の答え（`running healthy` など）を状態に読む。 */
export type ContainerState = 'healthy' | 'starting' | 'unhealthy' | 'stopped' | 'missing'

export const containerStateOf = (inspect: { readonly exitCode: number; readonly stdout: string } | null): ContainerState => {
  if (inspect === null || inspect.exitCode !== 0) return 'missing'
  const [status, health] = inspect.stdout.trim().split(/\s+/)
  if (status !== 'running') return 'stopped'
  if (health === undefined || health === '' || health === 'healthy') return 'healthy'
  return health === 'starting' ? 'starting' : 'unhealthy'
}

export const INSPECT_FORMAT = '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}'
