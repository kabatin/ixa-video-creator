import { parseArgs } from 'node:util'
import { z } from 'zod'

/** 引数を読む（純粋）。知らない引数は止める（打ち間違いを黙って無視しない）。 */

export const COMMANDS = ['setup', 'doctor', 'update', 'mcp', 'infra', 'help'] as const
export const INFRA_ACTIONS = ['up', 'down'] as const

const Options = z.object({
  command: z.enum(COMMANDS),
  /** `infra` のときだけ。 */
  action: z.enum(INFRA_ACTIONS).optional(),
  json: z.boolean(),
  yes: z.boolean(),
  force: z.boolean(),
  whileRunning: z.boolean(),
  check: z.boolean(),
  main: z.boolean(),
  afterFetch: z.boolean(),
  from: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, '--from は 0.8.0 の形で書きます')
    .optional(),
  claude: z.boolean(),
  codex: z.boolean(),
  write: z.boolean(),
})
export type Options = z.infer<typeof Options>

export const HELP = `使い方: pnpm ixa <コマンド> [オプション]

  setup    初めての導入（何度実行しても壊れない）。--yes で途中の質問をしない
  doctor   今の状態を ✓ / ! / ✗ で出す（読むだけ）。✗ があれば終了コード 1
  update   最新のリリースへ上げる。--main で main の先頭へ、--check で確かめるだけ、
           --force で「動いているジョブ」の確認を外す、--while-running で dev を動かしたまま進める
  mcp      Claude Code / Codex に MCP を登録する 1 行を出す。--claude / --codex、--write で実際に登録
  infra    up | down。この clone の postgres・redis を起こす・止める（pnpm infra:up / infra:down もこれ。ボリュームは消さない）

  共通: --json で機械向けに出す（各項目に fix.command・fix.needsHuman・docs）
  手順書: INSTALL.md`

export const parseCliArgs = (argv: readonly string[]): Options => {
  // `pnpm ixa -- doctor` のように `--` が前に付いてくることがある。
  const args = argv[0] === '--' ? argv.slice(1) : [...argv]
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      json: { type: 'boolean', default: false },
      yes: { type: 'boolean', short: 'y', default: false },
      force: { type: 'boolean', default: false },
      'while-running': { type: 'boolean', default: false },
      check: { type: 'boolean', default: false },
      main: { type: 'boolean', default: false },
      'after-fetch': { type: 'boolean', default: false },
      from: { type: 'string' },
      claude: { type: 'boolean', default: false },
      codex: { type: 'boolean', default: false },
      write: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  const command = values.help ? 'help' : (positionals[0] ?? 'help')
  const action = command === 'infra' ? positionals[1] : undefined
  if (command === 'infra' && (positionals.length !== 2 || !INFRA_ACTIONS.some((a) => a === action))) {
    throw new Error('infra の後には up か down を書きます（pnpm ixa infra up）')
  }
  if (command !== 'infra' && positionals.length > 1) throw new Error(`コマンドは 1 つだけ書きます（${positionals.join(' ')}）`)
  const parsed = Options.safeParse({
    command,
    action,
    json: values.json,
    yes: values.yes,
    force: values.force,
    whileRunning: values['while-running'],
    check: values.check,
    main: values.main,
    afterFetch: values['after-fetch'],
    from: values.from,
    claude: values.claude,
    codex: values.codex,
    write: values.write,
  })
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new Error(
      first?.path[0] === 'command' ? `知らないコマンドです: ${command}（${COMMANDS.join(' / ')}）` : (first?.message ?? '引数が不正です'),
    )
  }
  return parsed.data
}
