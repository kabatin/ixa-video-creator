import { parseArgs } from 'node:util'
import { z } from 'zod'

/** 引数を読む（純粋）。知らない引数は止める（打ち間違いを黙って無視しない）。 */

export const COMMANDS = ['setup', 'doctor', 'update', 'mcp', 'infra', 'ai', 'help'] as const
export const INFRA_ACTIONS = ['up', 'down'] as const
export const AI_ACTIONS = ['install', 'connect', 'status'] as const

/** `--models` / `--accept-licenses` の形（tools/ixa-ai/catalog.json の ID をカンマで並べる）。 */
const idList = (flag: string) =>
  z
    .string()
    .regex(/^[a-z0-9-]+(,[a-z0-9-]+)*$/, `${flag} はカンマ区切りの ID で書きます（例 h3,sa3-small）`)
    .optional()

const Options = z.object({
  command: z.enum(COMMANDS),
  /** `infra`・`ai` のときだけ。 */
  action: z.enum([...INFRA_ACTIONS, ...AI_ACTIONS]).optional(),
  /** `ai connect` の接続コード。**表示しない**（合言葉を含む）。 */
  code: z.string().optional(),
  models: idList('--models'),
  acceptLicenses: idList('--accept-licenses'),
  plan: z.boolean(),
  lan: z.boolean(),
  json: z.boolean(),
  yes: z.boolean(),
  force: z.boolean(),
  whileRunning: z.boolean(),
  check: z.boolean(),
  main: z.boolean(),
  afterFetch: z.boolean(),
  resume: z.boolean(),
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
           --force で「動いているジョブ」の確認を外す、--while-running で dev を動かしたまま進める、
           --resume で途中で止まった更新の続きをする
  mcp      Claude Code / Codex に MCP を登録する 1 行を出す。--claude / --codex、--write で実際に登録
  infra    up | down。この clone の postgres・redis を起こす・止める（pnpm infra:up / infra:down もこれ。ボリュームは消さない）
  ai       手元の生成 AI（ADR-0064）
           install  選んで入れる。--plan で一覧だけ（何も変えない）、--models h3,sa3-small と
                    --accept-licenses h3,sa3-small --yes で質問せずに入れる
           connect <接続コード>  別の Mac で入れた AI を .env につなぐ
           status   手元の AI サーバーに届くかだけを見る

  共通: --json で機械向けに出す（各項目に fix.command・fix.needsHuman・docs）
  手順書: INSTALL.md`

/** `ai` の後ろ（install | connect <接続コード> | status）。**接続コードは文に入れない。** */
const checkAiPositionals = (positionals: readonly string[], lan: boolean): void => {
  const action = positionals[1]
  if (!AI_ACTIONS.some((a) => a === action)) throw new Error('ai の後には install・connect・status のどれかを書きます（pnpm ixa ai install）')
  const expected = action === 'connect' ? 3 : 2
  if (positionals.length !== expected) {
    throw new Error(action === 'connect' ? 'ai connect の後には接続コードを 1 つだけ書きます' : `ai ${String(action)} の後ろに余分な語があります`)
  }
  if (lan) {
    throw new Error(
      '--lan は AI 用の別の Mac で使います: その Mac で uv run https://raw.githubusercontent.com/kabatin/ixa-video-creator/<版>/tools/ixa-ai/ixa_ai.py install --lan を回し、出た 1 行（pnpm ixa ai connect …）をこの Mac で貼る',
    )
  }
}

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
      resume: { type: 'boolean', default: false },
      from: { type: 'string' },
      claude: { type: 'boolean', default: false },
      codex: { type: 'boolean', default: false },
      write: { type: 'boolean', default: false },
      models: { type: 'string' },
      'accept-licenses': { type: 'string' },
      plan: { type: 'boolean', default: false },
      lan: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  const command = values.help ? 'help' : (positionals[0] ?? 'help')
  const action = command === 'infra' || command === 'ai' ? positionals[1] : undefined
  if (command === 'infra' && (positionals.length !== 2 || !INFRA_ACTIONS.some((a) => a === action))) {
    throw new Error('infra の後には up か down を書きます（pnpm ixa infra up）')
  }
  if (command === 'ai') checkAiPositionals(positionals, values.lan)
  if (command !== 'infra' && command !== 'ai' && positionals.length > 1) {
    throw new Error(`コマンドは 1 つだけ書きます（${positionals.join(' ')}）`)
  }
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
    resume: values.resume,
    from: values.from,
    claude: values.claude,
    codex: values.codex,
    write: values.write,
    code: command === 'ai' && action === 'connect' ? positionals[2] : undefined,
    models: values.models,
    acceptLicenses: values['accept-licenses'],
    plan: values.plan,
    lan: values.lan,
  })
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new Error(
      first?.path[0] === 'command' ? `知らないコマンドです: ${command}（${COMMANDS.join(' / ')}）` : (first?.message ?? '引数が不正です'),
    )
  }
  return parsed.data
}
