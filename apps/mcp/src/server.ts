import type { ToolRisk } from '@ixa/domain'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createApproveTool, waiveConfirmationsTool } from './tools/agent.js'
import { createCharacterTool, createLocationTool } from './tools/cast.js'
import { editShotsTool } from './tools/edit-shots.js'
import { addEffectsTool, listEffectsTool, removeEffectsTool } from './tools/effects.js'
import { generateSfxTool, listSfxTool, removeSfxTool, suggestSfxTool } from './tools/sfx.js'
import { exportTool } from './tools/export.js'
import { exportThumbnailTool } from './tools/export-thumbnail.js'
import { generateMusicTool } from './tools/music-generation.js'
import { musicOverviewTool, setMasterTrackTool, uploadMusicTool } from './tools/music.js'
import { planShotsTool } from './tools/plan-shots.js'
import { createProjectTool, getProjectTool } from './tools/project.js'
import {
  drawStartFramesTool,
  listStartFrameHistoryTool,
  retryImageTool,
  setStartFrameTool,
  useStartFrameTool,
} from './tools/start-frames.js'
import { setAiTool, statusTool } from './tools/status.js'
import { adoptTakeTool, generateTakesTool, listTakesTool, upscaleTakesTool } from './tools/takes.js'
import { reviewTakeTool } from './tools/review.js'
import { viewTool } from './tools/view.js'
import { analyzeMotionTool } from './tools/motion.js'
import { waitTool } from './tools/wait.js'
import type { ToolDef, ToolDeps } from './tool-def.js'

/** 登録するツール（制作の順）。 */
export const TOOLS: readonly ToolDef[] = [
  statusTool,
  setAiTool,
  createProjectTool,
  getProjectTool,
  generateMusicTool,
  uploadMusicTool,
  setMasterTrackTool,
  musicOverviewTool,
  planShotsTool,
  editShotsTool,
  createCharacterTool,
  createLocationTool,
  drawStartFramesTool,
  setStartFrameTool,
  listStartFrameHistoryTool,
  useStartFrameTool,
  retryImageTool,
  viewTool,
  generateTakesTool,
  listTakesTool,
  adoptTakeTool,
  reviewTakeTool,
  upscaleTakesTool,
  waitTool,
  addEffectsTool,
  listEffectsTool,
  removeEffectsTool,
  analyzeMotionTool,
  suggestSfxTool,
  generateSfxTool,
  listSfxTool,
  removeSfxTool,
  exportTool,
  exportThumbnailTool,
]

/**
 * AI エージェントの会話の中だけで足すツール（ADR-0058）。`approve` は CLI の `--permission-prompt-tool`。
 * `approve` 自身は確認に回らない（CLI が呼ばない）ので、表には自分以外を渡す。
 */
export const AGENT_TOOLS: readonly ToolDef[] = [
  createApproveTool(new Map([...TOOLS, waiveConfirmationsTool].map((t) => [t.name, t.risk]))),
  waiveConfirmationsTool,
]

/** 全ツールの危険度（ツール名 → 印）。 */
export const TOOL_RISKS: ReadonlyMap<string, ToolRisk> = new Map([...TOOLS, ...AGENT_TOOLS].map((t) => [t.name, t.risk]))

export const SERVER_INFO = { name: 'ixa', version: '0.7.0' } as const

/** MCP サーバを組み立てる。接続（stdio）は main.ts が行う。 */
export const createServer = (deps: ToolDeps): McpServer => {
  const server = new McpServer(SERVER_INFO, {
    instructions:
      'ixa makes music videos shot by shot. Call ixa_status first. User-visible text in ixa is Japanese. ' +
      'Generation is slow and runs on local GPUs: submit, then use wait (it returns within maxWaitSec), and use view ' +
      'to look at start frames and takes before adopting them.',
  })
  const tools = deps.agentSessionId === undefined ? TOOLS : [...TOOLS, ...AGENT_TOOLS]
  tools.forEach((tool) => {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.input,
        annotations: { readOnlyHint: tool.risk === 'read', destructiveHint: tool.risk === 'destructive' },
      },
      async (args, extra) => {
        const token = extra._meta?.progressToken
        const progress =
          token === undefined
            ? undefined
            : (done: number, total: number, message: string) =>
                extra.sendNotification({
                  method: 'notifications/progress',
                  params: { progressToken: token, progress: done, total, message },
                })
        return tool.run(args, progress === undefined ? deps : { ...deps, progress })
      },
    )
  })
  return server
}
