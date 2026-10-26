import path from 'node:path'
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

const PORT_PATTERN = /^\d{1,5}$/

/**
 * 書いたのに形が違う名前・ポート。**黙って既定に戻さない**（既定は 1 つ目の clone の名前なので、
 * 戻すとそのコンテナや DB を触ってしまう）。setup・infra・doctor はこれが空でないと先へ進まない。
 */
export const composeProblems = (env: EnvValues): readonly string[] => {
  const written = (key: string): string | null => {
    const value = (env[key] ?? '').trim()
    return value === '' ? null : value
  }
  const names = (['IXA_COMPOSE_PROJECT', 'IXA_COMPOSE_PREFIX'] as const)
    .filter((key) => {
      const value = written(key)
      return value !== null && !NAME_PATTERN.test(value)
    })
    .map((key) => `${key}: 形が違います（小文字の英数字・_・- だけで、英数字で始める）`)
  const ports = (['POSTGRES_PORT', 'REDIS_PORT'] as const)
    .filter((key) => {
      const value = written(key)
      return value !== null && (!PORT_PATTERN.test(value) || Number(value) < 1 || Number(value) > 65535)
    })
    .map((key) => `${key}: ポートの番号（1〜65535）で書いてください`)
  return [...names, ...ports, ...portMismatches(env)]
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

/**
 * `docker compose … down` の引数。**`-v` は決して付けない**（素材の DB とキューが消える）。
 * プロジェクト名を渡すので、2 つ目の clone から 1 つ目の clone のスタックを止めることは無い。
 */
export const composeDownArgs = (settings: ComposeSettings, repo: RepoPaths): readonly string[] => [
  'compose',
  '-p',
  settings.project,
  '--env-file',
  repo.env,
  '-f',
  repo.compose,
  'down',
]

/**
 * 打てる形の 1 行（直し方に出す）。名前・ポート・別の clone の見張りを通す CLI の口にする
 * （docker compose を直に打たせると、見張りを素通りする）。
 */
export const COMPOSE_UP_COMMAND = 'pnpm ixa infra up'

/** `docker inspect` の答え（`running|healthy|/path/infra`）を状態に読む。 */
export type ContainerState = 'healthy' | 'starting' | 'unhealthy' | 'stopped' | 'missing'

export type ContainerInfo = {
  readonly state: ContainerState
  /** compose が起動したときの場所（`…/infra`）。compose で起動したものでなければ null。 */
  readonly composeDir: string | null
}

type Inspect = { readonly exitCode: number; readonly stdout: string } | null

export const containerStateOf = (inspect: Inspect): ContainerState => {
  if (inspect === null || inspect.exitCode !== 0) return 'missing'
  const [status, health] = inspect.stdout.trim().split('|')
  if (status !== 'running') return 'stopped'
  if (health === undefined || health === '' || health === 'healthy') return 'healthy'
  return health === 'starting' ? 'starting' : 'unhealthy'
}

export const containerInfoOf = (inspect: Inspect): ContainerInfo => {
  const dir = inspect === null || inspect.exitCode !== 0 ? '' : (inspect.stdout.trim().split('|')[2] ?? '')
  return { state: containerStateOf(inspect), composeDir: dir === '' ? null : dir }
}

/** 区切りは `|`（場所に空白があっても割れない）。 */
export const INSPECT_FORMAT =
  '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{index .Config.Labels "com.docker.compose.project.working_dir"}}'

/**
 * そのコンテナはこの clone のものか。**同じ名前で別の clone が起こしたコンテナを使うと DB を共有する**
 * （別の作品・別のワークスペースが混ざる）。共有してよいかは人が決める（`.env` の IXA_COMPOSE_SHARED=true）。
 */
export type InfraOwner = { readonly kind: 'mine' | 'none' } | { readonly kind: 'other'; readonly dir: string }

export const infraOwnerOf = (infos: readonly ContainerInfo[], repoRoot: string): InfraOwner => {
  const mine = path.resolve(repoRoot, 'infra')
  const dirs = infos.map((i) => i.composeDir).filter((d): d is string => d !== null)
  const other = dirs.find((d) => path.resolve(d) !== mine)
  if (other !== undefined) return { kind: 'other', dir: path.dirname(other) }
  return dirs.length > 0 ? { kind: 'mine' } : { kind: 'none' }
}

/** 別の clone のコンテナを共有してよいと `.env` で決めてあるか。 */
export const infraSharedOf = (env: EnvValues): boolean => (env['IXA_COMPOSE_SHARED'] ?? '').trim() === 'true'

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/** URL のポート（書いていなければ既定）。この Mac の中を指していなければ null（Docker の口と比べない）。 */
export const loopbackPortOf = (url: string, fallback: number): number | null => {
  try {
    const parsed = new URL(url)
    if (!LOOPBACK_HOSTS.has(parsed.hostname)) return null
    return parsed.port === '' ? fallback : Number(parsed.port)
  } catch {
    return null
  }
}

/**
 * Docker で公開するポート（POSTGRES_PORT・REDIS_PORT）を書いたのに、つなぐ URL のポートが違う。
 * そのままだと、自分のコンテナを起こしたのに別のもの（1 つ目の clone の DB など）につながる。
 * **文に URL は入れない**（合言葉が入る）。
 */
export const portMismatches = (env: EnvValues): readonly string[] =>
  (
    [
      ['POSTGRES_PORT', 'DATABASE_URL', 5432],
      ['REDIS_PORT', 'REDIS_URL', 6379],
    ] as const
  )
    .filter(([portKey, urlKey, fallback]) => {
      const published = (env[portKey] ?? '').trim()
      if (published === '') return false
      const port = loopbackPortOf(env[urlKey] ?? '', fallback)
      return port !== null && port !== Number(published)
    })
    .map(([portKey, urlKey]) => `${portKey} と ${urlKey} のポートが違います（${urlKey} を ${portKey} に揃える）`)

/** そのポートを公開しているコンテナを探す `docker ps` の書式（名前|compose の場所）。 */
export const PUBLISHER_FORMAT = '{{.Names}}|{{.Label "com.docker.compose.project.working_dir"}}'

/** `docker ps --filter publish=<port>` の答え。動いているものしか出ないので状態は healthy とみなす。 */
export const publishersOf = (stdout: string): readonly ContainerInfo[] =>
  stdout
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const dir = line.slice(line.indexOf('|') + 1).trim()
      return { state: 'healthy' as const, composeDir: dir === '' ? null : dir }
    })
