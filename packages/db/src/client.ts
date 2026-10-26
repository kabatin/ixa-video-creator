import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import { drizzle, type PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { z } from 'zod'
import * as schema from './schema/index.js'

/** 接続プールの設定。値は呼び出し側（apps/*）が config から渡す。 */
export const DbClientOptions = z.object({
  /** プール内の最大接続数 */
  maxConnections: z.number().int().positive().default(10),
  /** アイドル接続を閉じるまでの秒数 */
  idleTimeoutSec: z.number().int().positive().default(30),
  /** 接続確立のタイムアウト秒数 */
  connectTimeoutSec: z.number().int().positive().default(10),
  /**
   * Postgres の NOTICE を捨てるか。既定は捨てない（postgres.js の既定どおり console に出る）。
   * `pnpm ixa` の DB の更新は NOTICE を大量に出し、点検の表示を埋めるので捨てる。
   */
  silenceNotices: z.boolean().default(false),
})
export type DbClientOptions = z.input<typeof DbClientOptions>

const DatabaseUrl = z
  .string()
  .min(1, 'DATABASE_URL が空です')
  .refine((u) => /^postgres(ql)?:\/\//.test(u), 'DATABASE_URL は postgres:// で始まること')

/**
 * postgres.js + drizzle のクライアントを生成する。
 * モジュールトップレベルでは接続しない。必ず呼び出し側がライフサイクルを管理し、
 * 終了時に closeDbClient を呼ぶこと。
 */
export const createDbClient = (databaseUrl: string, options: DbClientOptions = {}) => {
  const url = DatabaseUrl.parse(databaseUrl)
  const opts = DbClientOptions.parse(options)
  const sql = postgres(url, {
    max: opts.maxConnections,
    idle_timeout: opts.idleTimeoutSec,
    connect_timeout: opts.connectTimeoutSec,
    ...(opts.silenceNotices ? { onnotice: () => undefined } : {}),
  })
  return drizzle(sql, { schema })
}

export type DbClient = ReturnType<typeof createDbClient>

/**
 * リポジトリが書き込む相手。接続そのもの（`DbClient`）か、その中のトランザクション。
 * 取り消しの記録と書き込みを同じトランザクションで行うため（`edit-transaction.ts`）、
 * リポジトリはどちらでも作れるようにする。
 */
export type DbExecutor = PgDatabase<PostgresJsQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>

/** プールを閉じる。未完了のクエリは待ってから閉じる。 */
export const closeDbClient = async (client: DbClient): Promise<void> => {
  try {
    await client.$client.end()
  } catch (error) {
    throw new Error(`DB 接続の終了に失敗しました: ${String(error)}`, { cause: error })
  }
}
