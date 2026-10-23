import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

/**
 * MCP サーバの設定（CLAUDE.md 規約 4・6）。シークレット（`IXA_API_TOKEN`）は env からだけ読む。
 *
 * `.env` は読まない。MCP を登録する側（Claude Code / Codex の設定）が env を渡す。
 * リポジトリの `.env` には DB や外部 API の鍵が入っており、このプロセスに持たせる理由が無い。
 */

export const DEFAULT_API_URL = 'http://127.0.0.1:3001'

const expandHome = (path: string): string =>
  path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path

export const McpEnv = z.object({
  IXA_API_URL: z
    .string()
    .url()
    .default(DEFAULT_API_URL)
    .transform((url) => url.replace(/\/+$/, '')),
  /** 自動化用の鍵（ADR-0046）。`Authorization: Bearer` で送る。ログにも結果にも出さない。 */
  IXA_API_TOKEN: z.string().min(1, 'IXA_API_TOKEN（自動化用の鍵）を設定してください'),
  /** web の NEXT_PUBLIC_WORKSPACE_ID と同じ値。 */
  IXA_WORKSPACE_ID: z.string().ulid('IXA_WORKSPACE_ID は ULID で設定してください'),
  /** 書き出した動画を置く場所。 */
  IXA_MCP_OUTPUT_DIR: z
    .string()
    .min(1)
    .default('~/Movies/ixa-mcp')
    .transform(expandHome),
  /**
   * AI エージェントの会話の中で起こされたときの会話（ADR-0058）。API が渡す。
   * あるときだけ、会話の中で使うツール（approve・waive_confirmations）を登録する。
   */
  IXA_AGENT_SESSION_ID: z.string().ulid('IXA_AGENT_SESSION_ID は ULID で設定してください').optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
})
export type McpEnv = z.infer<typeof McpEnv>

/**
 * env を検証する。失敗したときの文に**値は載せない**（鍵がそのまま出るため）。項目名と理由だけ。
 */
export const parseMcpEnv = (source: Readonly<Record<string, string | undefined>>): McpEnv => {
  const result = McpEnv.safeParse(source)
  if (result.success) return result.data
  const problems = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
  throw new Error(`ixa MCP の設定が足りません — ${problems.join(' / ')}`)
}
