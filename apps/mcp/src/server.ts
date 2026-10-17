import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
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
import { drawStartFramesTool, setStartFrameTool } from './tools/start-frames.js'
import { setAiTool, statusTool } from './tools/status.js'
import { adoptTakeTool, generateTakesTool, listTakesTool, upscaleTakesTool } from './tools/takes.js'
import { viewTool } from './tools/view.js'
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
  viewTool,
  generateTakesTool,
  listTakesTool,
  adoptTakeTool,
  upscaleTakesTool,
  waitTool,
  addEffectsTool,
  listEffectsTool,
  removeEffectsTool,
  suggestSfxTool,
  generateSfxTool,
  listSfxTool,
  removeSfxTool,
  exportTool,
  exportThumbnailTool,
]

export const SERVER_INFO = { name: 'ixa', version: '0.6.0' } as const

/** MCP サーバを組み立てる。接続（stdio）は main.ts が行う。 */
export const createServer = (deps: ToolDeps): McpServer => {
  const server = new McpServer(SERVER_INFO, {
    instructions:
      'ixa makes music videos shot by shot. Call ixa_status first. User-visible text in ixa is Japanese. ' +
      'Generation is slow and runs on local GPUs: submit, then use wait (it returns within maxWaitSec), and use view ' +
      'to look at start frames and takes before adopting them.',
  })
  TOOLS.forEach((tool) => {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.input },
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
