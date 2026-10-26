import { HELP, parseCliArgs } from './args.js'
import { errorMessage, errorPayload } from './lib/errors.js'
import { doctorCommand } from './commands/doctor.js'
import { infraCommand } from './commands/infra.js'
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
    case 'infra':
      return infraCommand(system, repo, out, options)
  }
}

/**
 * 書き終えてから明示的に終える。postgres.js はつながらなかった接続の再試行の時計を残すので、
 * 待っていると DB が止まっている Mac で doctor が返らなかった（実測）。
 */
const exitAfterFlush = (code: number): void => {
  process.stdout.write('', () => process.exit(code))
}

main()
  .then(exitAfterFlush)
  .catch((error: unknown) => {
    // どこで投げても、--json なら JSON を 1 つだけ出す（合言葉は伏せる）。
    const argv = process.argv.slice(2)
    if (argv.includes('--json')) process.stdout.write(`${JSON.stringify(errorPayload(argv, error), null, 2)}\n`)
    else process.stderr.write(`ixa: ${errorMessage(error)}\n`)
    exitAfterFlush(1)
  })
