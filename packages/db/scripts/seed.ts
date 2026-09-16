/**
 * 開発用の seed 実行スクリプト。
 * 既定の Workspace を作り、その ULID を標準出力に出す。
 * Web の NEXT_PUBLIC_WORKSPACE_ID にこの値を設定する。
 */
import { closeDbClient, createDbClient } from '../src/client.js'
import { ensureDefaultWorkspace } from '../src/seed.js'

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
  } finally {
    await closeDbClient(db)
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`seed に失敗しました: ${String(error)}\n`)
  process.exit(1)
})
