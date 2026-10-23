import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AppConfig } from '@ixa/config'
import {
  createAgentSessionRepository,
  type AccessTokenRepository,
  type AgentSessionRepository,
  type DbClient,
  type ProjectRepository,
  type ShotRepository,
} from '@ixa/db'
import type { AiToolId } from '@ixa/domain'
import { processCommandOf, signalProcessGroup, spawnCliStreamRunner } from '@ixa/provider-llm'
import type { Logger } from '../logger.js'
import { createAgentHub, type AgentHub } from './agent-hub.js'
import { createAgentService, type AgentService } from './agent-service.js'

/**
 * AI エージェントのタブ（ADR-0058）の配線。`main.ts` だけが呼ぶ。
 *
 * ixa の MCP は、このリポジトリの `apps/mcp` を tsx で起こす（README の登録例と同じ形）。
 * MCP が呼ぶ API は、この API 自身（この Mac の中から呼ぶので 127.0.0.1）。
 */

export type AgentWiring = {
  readonly service: AgentService
  readonly sessions: AgentSessionRepository
  readonly hub: AgentHub
}

/** このファイル（apps/api/src/agent）からリポジトリの根へ。 */
const REPO_ROOT = resolve(import.meta.dirname, '../../../..')

export const createAgentWiring = (deps: {
  readonly db: DbClient
  readonly config: AppConfig
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly shots: Pick<ShotRepository, 'findById'>
  readonly tokens: Pick<AccessTokenRepository, 'create' | 'revoke' | 'listAutomation'>
  readonly textTool: () => Promise<AiToolId>
  readonly logger: Logger
}): AgentWiring => {
  const sessions = createAgentSessionRepository(deps.db)
  const hub = createAgentHub((error) => {
    deps.logger.warn({ err: error }, '会話の流れを配れませんでした')
  })
  const service = createAgentService({
    sessions,
    projects: deps.projects,
    shots: deps.shots,
    tokens: deps.tokens,
    hub,
    runner: spawnCliStreamRunner,
    textTool: deps.textTool,
    defaultModel: deps.config.agentModelDefault,
    cli: {
      command: 'claude',
      mcpCommand: join(REPO_ROOT, 'apps/mcp/node_modules/.bin/tsx'),
      mcpArgs: [join(REPO_ROOT, 'apps/mcp/src/main.ts')],
      apiUrl: `http://127.0.0.1:${String(deps.config.api.port)}`,
      sessionsRoot: join(homedir(), '.ixa', 'agent-sessions'),
      baseEnv: process.env,
    },
    processes: {
      // 番号は使い回されるので、エージェントの CLI（確認の口が approve）のときだけ止める。
      isAgentCli: async (pid) => {
        const command = await processCommandOf(pid)
        return command !== null && command.includes('claude') && command.includes('mcp__ixa__approve')
      },
      killGroup: (pid) => signalProcessGroup(pid, 'SIGTERM'),
    },
    now: () => new Date(),
    logger: deps.logger,
  })
  return { service, sessions, hub }
}
