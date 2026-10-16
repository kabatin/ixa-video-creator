import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createApiClient } from './api-client.js'
import { parseMcpEnv } from './env.js'
import { createFfmpegFrameExtractor } from './lib/frames.js'
import { createLogger } from './logger.js'
import { createServer } from './server.js'
import { realClock } from './tool-def.js'

/**
 * エントリポイント（規約 7b の例外: 末尾で main() を呼ぶ）。stdio で MCP を話す。
 * stdout はプロトコル専用。ログは stderr（logger.ts）。
 */
const main = async (): Promise<void> => {
  const env = parseMcpEnv(process.env)
  const logger = createLogger(env.LOG_LEVEL)
  const api = createApiClient({ baseUrl: env.IXA_API_URL, token: env.IXA_API_TOKEN, fetch: globalThis.fetch })
  const server = createServer({
    api,
    workspaceId: env.IXA_WORKSPACE_ID,
    outputDir: env.IXA_MCP_OUTPUT_DIR,
    logger,
    frames: createFfmpegFrameExtractor(),
    clock: realClock,
  })
  await server.connect(new StdioServerTransport())
  logger.info({ apiUrl: env.IXA_API_URL }, 'ixa MCP サーバを stdio で起動しました')
}

main().catch((error: unknown) => {
  // logger を作る前に落ちることがある（env の不足）。stderr に直接書く。stdout には書かない。
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
