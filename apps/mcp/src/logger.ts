import pino, { type DestinationStream, type Logger } from 'pino'

/**
 * MCP サーバのロガー。**必ず stderr に出す。** stdio の MCP では stdout がプロトコルそのもので、
 * 1 行でも混ざるとクライアントが壊れる（CLAUDE.md 規約 9 の console.log 禁止もここで満たす）。
 *
 * 鍵と署名付き URL はログに渡さない（呼ぶ側の規約）。念のため名前で伏せる。
 */
export const createLogger = (level: string, destination: DestinationStream = pino.destination(2)): Logger =>
  pino(
    {
      level,
      redact: {
        paths: ['token', 'authorization', 'headers.authorization', 'url', 'uploadUrl', '*.url', '*.uploadUrl'],
        censor: '[redacted]',
      },
    },
    destination,
  )

export type { Logger }
