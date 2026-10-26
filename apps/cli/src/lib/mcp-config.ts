/**
 * MCP の登録の 1 行（純粋、ADR-0063）。**アクセス用の鍵（IXA_API_TOKEN）は入れない。**
 * 鍵は制作者が画面で発行し、シェルの環境に置く（設定ファイルに値が残らないように）。
 * ワークスペースの ID と API の場所は秘密ではないので入れる。
 */

export type McpTarget = {
  readonly tsx: string
  readonly main: string
  readonly apiUrl: string
  readonly workspaceId: string
}

/** シェルにそのまま貼れる形。英数字と /._-:= 以外を含むときだけ '' で囲む。 */
export const shellQuote = (value: string): string =>
  /^[A-Za-z0-9/._\-:=]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`

export const claudeAddArgs = (t: McpTarget): readonly string[] => [
  'mcp',
  'add',
  'ixa',
  '--scope',
  'user',
  '-e',
  `IXA_API_URL=${t.apiUrl}`,
  '-e',
  `IXA_WORKSPACE_ID=${t.workspaceId}`,
  '--',
  t.tsx,
  t.main,
]

export const claudeAddCommand = (t: McpTarget): string => ['claude', ...claudeAddArgs(t)].map(shellQuote).join(' ')

const tomlString = (value: string): string => JSON.stringify(value)

/** Codex の `~/.codex/config.toml` に足す節。鍵は `env_vars` で名前だけ渡す（値はシェルから引き継ぐ）。 */
export const codexTomlSection = (t: McpTarget): string =>
  [
    '[mcp_servers.ixa]',
    `command = ${tomlString(t.tsx)}`,
    `args = [${tomlString(t.main)}]`,
    `env = { IXA_API_URL = ${tomlString(t.apiUrl)}, IXA_WORKSPACE_ID = ${tomlString(t.workspaceId)} }`,
    'env_vars = ["IXA_API_TOKEN"]',
    'startup_timeout_sec = 30',
    'tool_timeout_sec = 960',
  ].join('\n')

/** すでに `[mcp_servers.ixa]` があるか。 */
export const codexHasIxa = (toml: string): boolean => /^\s*\[mcp_servers\.ixa\]\s*$/m.test(toml)

export const appendCodexSection = (toml: string, section: string): string =>
  `${toml}${toml === '' || toml.endsWith('\n\n') ? '' : toml.endsWith('\n') ? '\n' : '\n\n'}${section}\n`
