import pino, { type Logger } from 'pino'

/**
 * api 全体で使う pino ロガーを作る。
 * console.log は使わない（CLAUDE.md 規約 9）。
 */
export const createLogger = (level: string): Logger => pino({ level })

export type { Logger }
