import { z } from 'zod'

/**
 * AI エージェントがする操作の危険度（ADR-0058）。MCP の各ツールが 1 つ持つ（`apps/mcp` の `ToolDef.risk`）。
 *
 * - `read`: 読むだけ
 * - `write`: ふつうの書き込み（Shot・テロップを直す、など。取り消しの履歴で戻せる）
 * - `destructive`: 消す
 * - `costly`: 時間・GPU・トークン・お金が掛かる（生成・レビュー・書き出し）
 * - `settings`: 作品や全体の設定を変える（使う AI の切り替え、など）
 */
export const ToolRisk = z.enum(['read', 'write', 'destructive', 'costly', 'settings'])
export type ToolRisk = z.infer<typeof ToolRisk>

/** Claude CLI が ixa の MCP のツールに付ける名前の頭（`--mcp-config` のサーバ名が `ixa`）。 */
export const IXA_MCP_TOOL_PREFIX = 'mcp__ixa__'

/**
 * CLI の名前（`mcp__ixa__generate_sfx`）から危険度を引く。表は MCP の印（`risks`）を渡す。写さない。
 * **印の無いツール・ixa 以外のツールは `destructive`**（確認を出す側に倒す）。
 */
export const toolRisk = (qualifiedName: string, risks: ReadonlyMap<string, ToolRisk>): ToolRisk => {
  if (!qualifiedName.startsWith(IXA_MCP_TOOL_PREFIX)) return 'destructive'
  return risks.get(qualifiedName.slice(IXA_MCP_TOOL_PREFIX.length)) ?? 'destructive'
}

/**
 * 実行の前に制作者に確認するか。読むだけとふつうの書き込みは確認しない。
 * それ以外は、そのタスクで「確認なしでいい」と言われていなければ確認する。
 */
export const approvalNeeded = (
  risk: ToolRisk,
  session: { readonly confirmationsWaived: boolean },
): boolean => {
  if (session.confirmationsWaived) return false
  return risk !== 'read' && risk !== 'write'
}

/** 会話の一覧に出す「直した数」に数える操作か（読むだけ以外）。 */
export const countsAsEdit = (risk: ToolRisk): boolean => risk !== 'read'
