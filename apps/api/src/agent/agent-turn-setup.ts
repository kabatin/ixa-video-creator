import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AccessTokenRepository } from '@ixa/db'
import type { AccessToken, AgentSessionId } from '@ixa/domain'
import { hashToken, issueToken } from '../auth/token.js'

/**
 * 1 回のやりとりの用意と後片付け（ADR-0058）。
 *
 * - **鍵**: やりとりごとに、期限 2 時間の自動化用の鍵を内部で発行し、終わったら取り消す。
 *   鍵そのものは MCP の設定ファイルの env にだけ書く（ログ・会話の行・応答には出さない）。
 * - **作業場所**: 会話ごとに固定する（`~/.ixa/agent-sessions/<会話>/`）。`--resume` は同じ場所でないと続きを見つけられない。
 * - **MCP の設定ファイル**: 作業場所に権限 600 で置き、やりとりが終わったら消す。
 */

export const TURN_KEY_TTL_MS = 2 * 60 * 60 * 1000
/** 鍵の名前の頭。起動時に、取り消し忘れの鍵をこれで見つけて取り消す。 */
export const AGENT_KEY_LABEL_PREFIX = 'AI エージェント（会話 '

export type AgentTurnKey = {
  /** 鍵そのもの。**設定ファイルの env にだけ渡す。** */
  readonly token: string
  readonly tokenHash: string
  readonly record: AccessToken
}

const LABEL_MAX = 80

export const turnKeyLabel = (title: string): string => {
  const label = `${AGENT_KEY_LABEL_PREFIX}${title}）`
  return Array.from(label).length <= LABEL_MAX
    ? label
    : `${Array.from(label).slice(0, LABEL_MAX - 2).join('')}…）`
}

export const issueTurnKey = async (
  tokens: Pick<AccessTokenRepository, 'create'>,
  title: string,
  now: Date,
): Promise<AgentTurnKey> => {
  const token = issueToken()
  const tokenHash = hashToken(token)
  const record = await tokens.create({
    kind: 'automation',
    label: turnKeyLabel(title),
    tokenHash,
    expiresAt: new Date(now.getTime() + TURN_KEY_TTL_MS),
  })
  return { token, tokenHash, record }
}

export const sessionWorkDir = (root: string, sessionId: AgentSessionId): string => join(root, sessionId)

/** 作業場所を作り、MCP の設定ファイルを権限 600 で置く。置いた場所を返す。 */
export const writeMcpConfigFile = async (
  workDir: string,
  turnId: string,
  config: unknown,
): Promise<string> => {
  await mkdir(workDir, { recursive: true, mode: 0o700 })
  const path = join(workDir, `mcp-${turnId}.json`)
  await writeFile(path, JSON.stringify(config), { mode: 0o600, flag: 'wx' })
  return path
}

export const removeMcpConfigFile = (path: string): Promise<void> => rm(path, { force: true })
