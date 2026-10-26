import { HELP, parseCliArgs } from './args.js'
import { doctorCommand } from './commands/doctor.js'
import { mcpCommand } from './commands/mcp.js'
import { setupCommand } from './commands/setup.js'
import { updateCommand } from './commands/update.js'
import { REPO_ROOT, paths } from './lib/repo.js'
import { createOutput } from './printer.js'
import { createRealSystem } from './real-system.js'

/**
 * エントリポイント（規約 7b の例外: 末尾で main() を呼ぶ）。`pnpm ixa <コマンド>`（ADR-0063）。
 * 外の口（real-system）を作って、コマンドに渡すだけ。判定はコマンドの先の純粋な関数。
 */
const main = async (): Promise<number> => {
  const options = parseCliArgs(process.argv.slice(2))
  const system = createRealSystem()
  // シンボリックリンク越しの clone でも、コンテナやポートの持ち主と同じ書き方で比べる。
  const repo = paths(await system.realpath(REPO_ROOT))
  const out = createOutput(options.json)
  switch (options.command) {
    case 'help':
      out.line(HELP)
      out.result({ command: 'help', ok: true, help: HELP })
      return 0
    case 'doctor':
      return doctorCommand(system, repo, out)
    case 'setup':
      return setupCommand(system, repo, out, options)
    case 'update':
      return updateCommand(system, repo, out, options)
    case 'mcp':
      return mcpCommand(system, repo, out, options)
  }
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    process.stderr.write(`ixa: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
