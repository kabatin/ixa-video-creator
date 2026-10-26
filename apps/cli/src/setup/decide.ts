import type { ContainerState } from '../lib/compose.js'
import { envKeysOf, isBlank, parseEnvFile } from '../lib/env-file.js'

/**
 * setup の「済みか・何をするか」の判定（純粋、ADR-0063）。**値の入った行は決して書き換えない。**
 */

/** 署名の鍵：入っていれば何もしない。空の行があれば埋める。行が無ければ足す。 */
export type SigningSecretAction = 'already' | 'fill' | 'append'

export const signingSecretAction = (envContent: string): SigningSecretAction => {
  if (!isBlank(parseEnvFile(envContent), 'STORAGE_SIGNING_SECRET')) return 'already'
  return envKeysOf(envContent).includes('STORAGE_SIGNING_SECRET') ? 'fill' : 'append'
}

/**
 * ワークスペース：
 * - `.env` の ID がこの DB にある → 済み
 * - `.env` が空 → 既定のワークスペースを用意（あればそれ）して ID を書く
 * - `.env` の ID がこの DB に無い → 止めて人に聞く（別の DB の ID かもしれない。上書きしない）
 */
export type WorkspaceAction = 'already' | 'ensure-and-fill' | 'mismatch'

export const workspaceAction = (envWorkspaceId: string | null, existingIds: readonly string[]): WorkspaceAction => {
  if (envWorkspaceId === null) return 'ensure-and-fill'
  return existingIds.includes(envWorkspaceId) ? 'already' : 'mismatch'
}

/**
 * Docker：両方が動いていれば済み。つながるなら（Docker の外で動かしている）触らない。
 * どちらかが無い・止まっているなら起動する。起動中なら待つだけ。
 */
export type InfraAction = 'already' | 'external' | 'start' | 'wait'

export const infraAction = (
  postgres: ContainerState,
  redis: ContainerState,
  reachable: { readonly postgres: boolean; readonly redis: boolean },
): InfraAction => {
  if (postgres === 'healthy' && redis === 'healthy') return 'already'
  if (reachable.postgres && reachable.redis) return 'external'
  const needsStart = (state: ContainerState) => state === 'missing' || state === 'stopped' || state === 'unhealthy'
  return needsStart(postgres) || needsStart(redis) ? 'start' : 'wait'
}

/** 待つのを止める時。両方が動いたか、どちらかが起動に失敗した。 */
export const infraSettled = (postgres: ContainerState, redis: ContainerState): 'ready' | 'pending' | 'broken' => {
  if (postgres === 'healthy' && redis === 'healthy') return 'ready'
  return postgres === 'unhealthy' || redis === 'unhealthy' ? 'broken' : 'pending'
}
