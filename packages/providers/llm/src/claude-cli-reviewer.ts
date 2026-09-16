import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { LLM_REVIEWERS, ReviewerType } from '@ixa/domain'
import { z } from 'zod'
import {
  CliExitFailedError,
  CliNotFoundError,
  CliResponseNotJsonError,
  CliResponseSchemaError,
  CliSpawnFailedError,
  CliTimeoutError,
  UnsupportedReviewerError,
  type VisionReviewerErrorContext,
} from './errors.js'
import {
  VisionReviewRequest,
  VisionReviewResult,
  type VisionReviewOutcome,
  type VisionReviewer,
} from './port.js'

/**
 * Claude Code CLI をサブプロセスとして呼ぶ vision レビュア（ADR-0012）。
 *
 * `claude -p "..." --output-format json` はヘッドレス実行で
 * `result` / `total_cost_usd` を含む JSON を返す。その `result`（本文）の中に
 * 判定 JSON が入っている、という**二重の JSON** を解く必要がある。
 * どちらの段で壊れたかは `CliResponseNotJsonError.stage` で区別する。
 *
 * **応答は必ず `VisionReviewResult` で検証する。通らなければ例外**（port.ts の方針）。
 */

export const CLAUDE_CLI_REVIEWER_NAME = 'claude-cli-vision-reviewer'

/** ハングした CLI がキューを詰まらせるため必ず設定する。既定 10 分（ADR-0012）。 */
export const DEFAULT_CLI_TIMEOUT_MS = 10 * 60 * 1000

/** stdout を無制限に溜めない。巨大な出力は CLI 側の異常なので切り上げてよい。 */
const MAX_STDOUT_BYTES = 10 * 1024 * 1024

/**
 * サブプロセス実行のポート。**実 CLI を CI で叩かないため**に注入できるようにしてある
 * （ADR-0004 の契約テスト方針）。
 */
export type CliInvocation = {
  readonly command: string
  readonly args: readonly string[]
  readonly timeoutMs: number
}

/**
 * 実行結果。**想定内の失敗は throw せず kind で返す。**
 * こうしておくとテスト側のモックが Node のエラー形（`ENOENT` など）を真似ずに済む。
 */
export type CliRunResult =
  | { readonly kind: 'completed'; readonly exitCode: number; readonly stdout: string; readonly stderr: string }
  | { readonly kind: 'timeout'; readonly timeoutMs: number }
  | { readonly kind: 'not_found'; readonly reason: string }
  | { readonly kind: 'spawn_failed'; readonly reason: string }

export type CliRunner = (invocation: CliInvocation) => Promise<CliRunResult>

/** Claude Code CLI がヘッドレス実行で返す外枠（ADR-0012）。必要な項目だけを契約にする。 */
export const ClaudeCliEnvelope = z.object({
  result: z.string(),
  /** 実測コスト。CLI が返さなければ 0 を使う（推測値を入れない）。 */
  total_cost_usd: z.number().nonnegative().optional(),
  is_error: z.boolean().optional(),
})
export type ClaudeCliEnvelope = z.infer<typeof ClaudeCliEnvelope>

const sha256Short = (value: string): string =>
  createHash('sha256').update(value).digest('hex').slice(0, 12)

/**
 * プロンプト本文を伏せたコマンド文字列。
 * プロンプトには都度発行した署名付き URL が入るため、**そのままログへ出さない**
 * （CLAUDE.md 規約 7）。同一性の追跡はダイジェストで足りる。
 */
export const redactCommand = (
  binary: string,
  args: readonly string[],
  prompt: string,
): string =>
  [
    binary,
    ...args.map((arg) =>
      arg === prompt ? `<prompt:${prompt.length}chars sha256=${sha256Short(prompt)}>` : arg,
    ),
  ].join(' ')

const imageLines = (title: string, images: readonly { label: string; url: string }[]): string =>
  images.length === 0
    ? `${title}: なし`
    : [`${title}:`, ...images.map((image) => `- ${image.label}: ${image.url}`)].join('\n')

/**
 * 判定依頼をプロンプトへ組み立てる。**自由文を返させない**ため、
 * 出力形式を明示し、値域と null の意味まで書く。テストのために公開する。
 */
export const buildReviewPrompt = (request: VisionReviewRequest): string =>
  [
    `あなたは映像の ${request.reviewer} レビュアです。以下の画像を判定してください。`,
    '',
    imageLines('判定対象', request.subjects),
    '',
    imageLines('比較対象', request.references),
    '',
    `判定基準: ${request.criteria}`,
    '',
    '次の JSON だけを出力してください。前後に説明文を付けないでください。',
    '{',
    '  "severity": "info" | "warn" | "fail",',
    '  "score": 0 以上 1 以下の数値（1 が完全に一致）,',
    '  "message": 指摘を 1 文で書いた文字列,',
    '  "frameSec": 指摘箇所の秒数。分からなければ null,',
    '  "suggestedPromptDelta": 再生成時に足すべき具体的な指示。直す点が無ければ null',
    '}',
    '',
    'suggestedPromptDelta に「頑張って」のような抽象的な指示を書かないでください。',
  ].join('\n')

type CliArgsInput = {
  readonly prompt: string
  readonly model: string | null
  readonly allowedTools: readonly string[]
  readonly permissionMode: string | null
}

/** 実行引数の組み立て。テストで固定できるよう公開する。 */
export const buildCliArgs = ({
  prompt,
  model,
  allowedTools,
  permissionMode,
}: CliArgsInput): readonly string[] => [
  '-p',
  prompt,
  '--output-format',
  'json',
  ...(allowedTools.length > 0 ? ['--allowedTools', allowedTools.join(',')] : []),
  ...(permissionMode === null ? [] : ['--permission-mode', permissionMode]),
  ...(model === null ? [] : ['--model', model]),
]

/**
 * 応答本文から JSON 部分を取り出す。
 * LLM は ```json フェンスを付けがちで、それだけの理由で失敗させる意味はない。
 * **フェンスの除去までが許容範囲**で、形が違えば例外にする。
 */
export const extractJsonText = (resultText: string): string => {
  const trimmed = resultText.trim()
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/.exec(trimmed)
  if (fenced !== null) {
    const [, inner] = fenced
    if (inner !== undefined) return inner.trim()
  }
  return trimmed
}

const parseJson = (
  text: string,
  stage: 'envelope' | 'result',
  context: VisionReviewerErrorContext,
): unknown => {
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed
  } catch (error) {
    // 握り潰さない。元の例外を cause に残したまま、文脈付きの型へ載せ替える。
    throw new CliResponseNotJsonError(stage, text, context, { cause: error })
  }
}

const formatIssues = (error: z.ZodError): readonly string[] =>
  error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)

/** 既定のサブプロセス実行。想定内の失敗は kind へ落とし、例外は投げない。 */
export const execFileCliRunner: CliRunner = (invocation) =>
  new Promise<CliRunResult>((resolve) => {
    execFile(
      invocation.command,
      [...invocation.args],
      { timeout: invocation.timeoutMs, maxBuffer: MAX_STDOUT_BYTES, killSignal: 'SIGKILL' },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ kind: 'completed', exitCode: 0, stdout, stderr })
          return
        }
        if (error.code === 'ENOENT') {
          resolve({ kind: 'not_found', reason: error.message })
          return
        }
        // execFile は timeout で killSignal を送る。exit code より先に判定する。
        if (error.code === 'ETIMEDOUT' || error.killed === true) {
          resolve({ kind: 'timeout', timeoutMs: invocation.timeoutMs })
          return
        }
        if (typeof error.code === 'number') {
          resolve({ kind: 'completed', exitCode: error.code, stdout, stderr })
          return
        }
        resolve({ kind: 'spawn_failed', reason: error.message })
      },
    )
  })

const ClaudeCliOptionsSchema = z.object({
  name: z.string().min(1).default(CLAUDE_CLI_REVIEWER_NAME),
  binary: z.string().min(1).default('claude'),
  supports: z.array(ReviewerType).min(1).default([...LLM_REVIEWERS]),
  timeoutMs: z.number().int().positive().default(DEFAULT_CLI_TIMEOUT_MS),
  model: z.string().min(1).nullable().default(null),
  /** 画像 URL を読むために既定で WebFetch のみ許す。広げるのは運用側の判断。 */
  allowedTools: z.array(z.string().min(1)).default(['WebFetch']),
  /**
   * 無人実行でプロンプトを抑止したい場合に指定する（ADR-0012）。
   * どこまで緩めるかは運用上の判断なので、既定では渡さない。
   */
  permissionMode: z.string().min(1).nullable().default(null),
})

export type ClaudeCliVisionReviewerOptions = {
  name?: string
  binary?: string
  supports?: readonly ReviewerType[]
  timeoutMs?: number
  model?: string | null
  allowedTools?: readonly string[]
  permissionMode?: string | null
  /** 実 CLI を叩かずに契約テストを書くための差し込み口。既定は execFile 実装。 */
  runner?: CliRunner
}

export const createClaudeCliVisionReviewer = (
  options: ClaudeCliVisionReviewerOptions = {},
): VisionReviewer => {
  const { runner = execFileCliRunner, ...rest } = options
  const config = ClaudeCliOptionsSchema.parse(rest)
  const frozenSupports: readonly ReviewerType[] = Object.freeze([...config.supports])

  const runSafely = async (
    invocation: CliInvocation,
    context: VisionReviewerErrorContext,
  ): Promise<CliRunResult> => {
    try {
      return await runner(invocation)
    } catch (error) {
      // 注入された runner が想定外に throw した場合も文脈を付けて載せ替える。
      const reason = error instanceof Error ? error.message : String(error)
      throw new CliSpawnFailedError(reason, context, { cause: error })
    }
  }

  const toStdout = (run: CliRunResult, context: VisionReviewerErrorContext): string => {
    switch (run.kind) {
      case 'not_found':
        throw new CliNotFoundError(config.binary, run.reason, context)
      case 'timeout':
        throw new CliTimeoutError(run.timeoutMs, context)
      case 'spawn_failed':
        throw new CliSpawnFailedError(run.reason, context)
      case 'completed':
        // exit code を先に見てから出力を解釈する（ADR-0012 の実装上の規約）。
        if (run.exitCode !== 0) throw new CliExitFailedError(run.exitCode, run.stderr, context)
        return run.stdout
    }
  }

  const review = async (request: VisionReviewRequest): Promise<VisionReviewOutcome> => {
    const parsed = VisionReviewRequest.parse(request)
    const prompt = buildReviewPrompt(parsed)
    const args = buildCliArgs({
      prompt,
      model: config.model,
      allowedTools: config.allowedTools,
      permissionMode: config.permissionMode,
    })
    const context: VisionReviewerErrorContext = {
      reviewer: parsed.reviewer,
      command: redactCommand(config.binary, args, prompt),
      adapter: config.name,
    }

    if (!frozenSupports.includes(parsed.reviewer)) {
      throw new UnsupportedReviewerError(frozenSupports, context)
    }

    const run = await runSafely(
      { command: config.binary, args, timeoutMs: config.timeoutMs },
      context,
    )
    const stdout = toStdout(run, context)

    const envelope = ClaudeCliEnvelope.safeParse(parseJson(stdout, 'envelope', context))
    if (!envelope.success) {
      throw new CliResponseSchemaError('envelope', formatIssues(envelope.error), stdout, context)
    }
    if (envelope.data.is_error === true) {
      throw new CliExitFailedError(0, `CLI が is_error を返しました: ${envelope.data.result}`, context)
    }

    const resultText = extractJsonText(envelope.data.result)
    const result = VisionReviewResult.safeParse(parseJson(resultText, 'result', context))
    if (!result.success) {
      throw new CliResponseSchemaError('result', formatIssues(result.error), resultText, context)
    }

    return { result: result.data, costUsd: envelope.data.total_cost_usd ?? 0 }
  }

  return { name: config.name, supports: frozenSupports, review }
}
