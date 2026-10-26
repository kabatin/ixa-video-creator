import path from 'node:path'
import { z } from 'zod'
import type { EnvValues } from './env-file.js'

/**
 * リポジトリの場所と、そこから決まる値（ADR-0063）。
 * CLI は `pnpm --filter @ixa/cli` で `apps/cli` の中で走るので、直下はこのファイルから 3 つ上。
 */

export const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..')

export const ROOT_PACKAGE_NAME = 'ixa-video-creator'

/** 公開しているリポジトリ（リリースノートの案内に使う）。 */
export const RELEASES_URL = 'https://github.com/kabatin/ixa-video-creator/releases'

/** web の待ち受けポート（apps/web/package.json の dev スクリプトが持つ）。 */
export const WEB_PORT = 3000

/** 画面で「アクセス用の鍵」を発行する場所。 */
export const ACCESS_KEYS_PATH = '/access-keys'

export const paths = (root: string) => ({
  root,
  env: path.join(root, '.env'),
  envExample: path.join(root, '.env.example'),
  webEnvLocal: path.join(root, 'apps', 'web', '.env.local'),
  rootPackage: path.join(root, 'package.json'),
  compose: path.join(root, 'infra', 'docker-compose.yml'),
  audioDir: path.join(root, 'apps', 'audio'),
  audioVenv: path.join(root, 'apps', 'audio', '.venv'),
  nodeModules: path.join(root, 'node_modules'),
  mcpTsx: path.join(root, 'apps', 'mcp', 'node_modules', '.bin', 'tsx'),
  mcpMain: path.join(root, 'apps', 'mcp', 'src', 'main.ts'),
})
export type RepoPaths = ReturnType<typeof paths>

const RootPackage = z.object({
  name: z.string(),
  version: z.string(),
  packageManager: z.string().optional(),
})
export type RootPackage = z.infer<typeof RootPackage>

export const parseRootPackage = (content: string): RootPackage => {
  try {
    return RootPackage.parse(JSON.parse(content))
  } catch (error) {
    throw new Error(`package.json を読めませんでした: ${String(error)}`, { cause: error })
  }
}

/** `pnpm@9.15.4` → `9.15.4`。 */
export const expectedPnpmVersion = (pkg: RootPackage): string | null =>
  /^pnpm@(\d+\.\d+\.\d+)/.exec(pkg.packageManager ?? '')?.[1] ?? null

const numberOr = (value: string | undefined, fallback: number): number => {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

/** `.env` から決まるポート。 */
export const portsOf = (env: EnvValues) => ({
  web: WEB_PORT,
  api: numberOr(env['API_PORT'], 3001),
  audio: numberOr(env['AUDIO_PORT'], 8100),
})

/** 素材の置き場（`packages/config` の既定と同じ）。 */
export const storageRootOf = (env: EnvValues, homedir: string): string => {
  const dir = (env['STORAGE_DIR'] ?? '').trim()
  return dir === '' ? path.join(homedir, 'ixa-video-creator', 'storage') : dir
}
