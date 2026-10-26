import { COMMANDS } from '../args.js'

/**
 * 投げられた失敗を、表示してよい文にする（純粋）。**URL の合言葉は伏せる**（postgres.js などの文は接続先を含むことがある）。
 */

export const redactUrls = (text: string): string => text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1***@')

export const errorMessage = (error: unknown): string =>
  redactUrls(error instanceof Error ? error.message : String(error))
    .replace(/\s*\n\s*/g, ' ')
    .trim()

/** `--json` のときの最上位の失敗。stdout に JSON を 1 つだけ出す。 */
export const errorPayload = (argv: readonly string[], error: unknown) => {
  const command = argv.find((arg) => COMMANDS.some((c) => c === arg)) ?? 'unknown'
  return { command, ok: false, error: errorMessage(error) }
}
