/**
 * 開発用の seed 実行スクリプト。
 * 既定の Workspace を作り、その ULID を標準出力に出す（スクリプトから使えるよう 1 行だけ）。
 *
 * **リポジトリ直下の `.env` の `NEXT_PUBLIC_WORKSPACE_ID=` が空なら、そこへ書き込む。**
 * まっさらな clone で README どおりに進めると、ID を 1 行出すだけで置き場所が分からず、
 * 一覧が「設定が不足しています」で止まっていた。値が入っていれば上書きせず、案内だけ出す。
 * 案内は標準エラーへ（標準出力は ID だけにしておく）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { closeDbClient, createDbClient } from '../src/client.js'
import { fillEmptyEnvValue } from '../src/env-file.js'
import { ensureDefaultWorkspace } from '../src/seed.js'

const WORKSPACE_KEY = 'NEXT_PUBLIC_WORKSPACE_ID'

/** 直下の `.env` の空欄を埋める。埋めたかどうかを返す。 */
const rememberWorkspace = (workspaceId: string): boolean => {
  const envPath = resolve(process.cwd(), '../../.env')
  if (!existsSync(envPath)) return false
  const next = fillEmptyEnvValue(readFileSync(envPath, 'utf8'), WORKSPACE_KEY, workspaceId)
  if (next === null) return false
  writeFileSync(envPath, next)
  return true
}

const main = async (): Promise<void> => {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    process.stderr.write('DATABASE_URL が設定されていません\n')
    process.exit(1)
  }

  const db = createDbClient(databaseUrl)
  try {
    const workspace = await ensureDefaultWorkspace(db)
    process.stdout.write(`${workspace.id}\n`)
    process.stderr.write(
      rememberWorkspace(workspace.id)
        ? `.env の ${WORKSPACE_KEY} にこの ID を書き込みました。\n`
        : `.env の ${WORKSPACE_KEY} にこの ID を設定してください（すでに値があれば、そのままで構いません）。\n`,
    )
  } finally {
    await closeDbClient(db)
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`seed に失敗しました: ${String(error)}\n`)
  process.exit(1)
})
