import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * API が落ちたあとに残ったエージェントの CLI の後片付け（ADR-0058。レビュー 2026-10-23）。
 *
 * CLI は自分のプロセスグループで起こす（`spawnCliStreamRunner`）。API が落ちると親を失って残るので、
 * やりとりの間は作業場所に番号（`cli.pid`）を書いておき、起動時にそのグループを止める。
 * 番号は使い回されるので、**止める前にエージェントの CLI かを確かめる**（`isAgentCli`）。
 * 鍵を書いた MCP の設定ファイル（`mcp-*.json`）も、起動時に残っていれば消す。
 */

export const CLI_PID_FILE = 'cli.pid'

export type AgentProcesses = {
  /** その番号のプロセスが、いまもエージェントの CLI か。 */
  readonly isAgentCli: (pid: number) => Promise<boolean>
  readonly killGroup: (pid: number) => void
}

export const writeCliPid = (workDir: string, pid: number): Promise<void> =>
  writeFile(join(workDir, CLI_PID_FILE), String(pid), { mode: 0o600 })

export const removeCliPid = (workDir: string): Promise<void> => rm(join(workDir, CLI_PID_FILE), { force: true })

const readPid = async (path: string): Promise<number | null> => {
  try {
    const pid = Number((await readFile(path, 'utf8')).trim())
    return Number.isInteger(pid) && pid > 1 ? pid : null
  } catch {
    return null
  }
}

const listDirs = async (root: string): Promise<readonly string[]> => {
  try {
    return (await readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => join(root, e.name))
  } catch {
    // まだ一度も会話が無い（作業場所の親が無い）。片付けるものは無い。
    return []
  }
}

/** 作業場所を見て回り、残った CLI を止め、番号と MCP の設定ファイルを消す。止めた数と消したファイルの数を返す。 */
export const sweepAgentWorkDirs = async (
  root: string,
  processes: AgentProcesses,
): Promise<{ readonly killed: number; readonly removedConfigs: number }> => {
  const results = await Promise.all(
    (await listDirs(root)).map(async (dir) => {
      const pid = await readPid(join(dir, CLI_PID_FILE))
      const kill = pid !== null && (await processes.isAgentCli(pid))
      if (kill) processes.killGroup(pid)
      await removeCliPid(dir)
      const configs = (await readdir(dir)).filter((name) => /^mcp-.*\.json$/.test(name))
      await Promise.all(configs.map((name) => rm(join(dir, name), { force: true })))
      return { killed: kill ? 1 : 0, removedConfigs: configs.length }
    }),
  )
  return results.reduce((acc, r) => ({ killed: acc.killed + r.killed, removedConfigs: acc.removedConfigs + r.removedConfigs }), {
    killed: 0,
    removedConfigs: 0,
  })
}
