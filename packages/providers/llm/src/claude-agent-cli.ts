import { AgentModel, IXA_MCP_TOOL_PREFIX } from '@ixa/domain'
import { z } from 'zod'

/**
 * AI エージェントのタブ（ADR-0058）の Claude CLI の起こし方。形は CLI 2.1.289 で実際に流して確かめた。
 *
 * - `-p --output-format stream-json --verbose`: 1 行ずつ流す（domain の `parseStreamJsonLine` が読む）
 * - `--mcp-config <file> --strict-mcp-config`: ixa の MCP だけ。制作者が登録したほかの MCP は使わない
 * - `--tools ""`: 組み込みのツール（Bash・ファイルの読み書き）を外す
 * - `--setting-sources "" --permission-mode manual`: 制作者の ~/.claude の設定を効かせない。
 *   効かせると auto モードが削除を確認なしで許し、制作者のフックも走った（実測）
 * - `--permission-prompt-tool mcp__ixa__approve`: ツールを使う前に必ず approve に聞く。
 *   **`--allowedTools` は付けない。** 付けたツールは approve を通らずに走った（実測）
 * - 2 回目からは `--resume <会話 ID>`。同じ作業場所でないと続きを見つけられない
 */

/** MCP の設定でのサーバ名。CLI はツールを `mcp__ixa__<名前>` と呼ぶ（domain の `IXA_MCP_TOOL_PREFIX`）。 */
export const AGENT_MCP_SERVER_NAME = 'ixa'

/** CLI の会話 ID。引数に渡すので、英数字と `-` だけ（先頭は英数字）。 */
const CliSessionId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/)

export const buildAgentCliArgs = (input: {
  readonly model: string
  readonly mcpConfigPath: string
  readonly resumeCliSessionId: string | null
}): readonly string[] => [
  '-p',
  '--output-format',
  'stream-json',
  '--verbose',
  '--model',
  AgentModel.parse(input.model),
  '--mcp-config',
  input.mcpConfigPath,
  '--strict-mcp-config',
  '--tools',
  '',
  '--setting-sources',
  '',
  '--permission-mode',
  'manual',
  '--disable-slash-commands',
  '--permission-prompt-tool',
  `${IXA_MCP_TOOL_PREFIX}approve`,
  ...(input.resumeCliSessionId === null ? [] : ['--resume', CliSessionId.parse(input.resumeCliSessionId)]),
]

export type AgentMcpServer = {
  readonly command: string
  readonly args: readonly string[]
  /** MCP に渡す env（鍵を含む）。**この設定ファイルにだけ書く**（権限 600、終わったら消す）。 */
  readonly env: Readonly<Record<string, string>>
}

export const buildAgentMcpConfig = (server: AgentMcpServer) => ({
  mcpServers: { [AGENT_MCP_SERVER_NAME]: { command: server.command, args: [...server.args], env: { ...server.env } } },
})

/** CLI が動くのに要る env の名前。これ以外（DB・外部の鍵・合言葉）は子に渡さない。 */
const PASSED_ENV = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TERM'] as const

export const agentCliEnv = (source: Readonly<Record<string, string | undefined>>): Readonly<Record<string, string>> =>
  Object.fromEntries(
    PASSED_ENV.flatMap((name) => {
      const value = source[name]
      return value === undefined ? [] : [[name, value]]
    }),
  )
