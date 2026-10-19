import {
  IMAGE_CHECK_ISSUE_MESSAGE_MAX_LENGTH,
  IMAGE_CHECK_MAX_ISSUES,
  IMAGE_CHECK_PROMPT_DELTA_MAX_LENGTH,
  ImageCheckResult,
  type ImageJobKind,
} from '@ixa/domain'
import { z } from 'zod'
import { DEFAULT_CLI_TIMEOUT_MS, execFileCliRunner, redactCommand, type CliRunResult, type CliRunner } from '@ixa/provider-core'
import {
  buildCliArgs,
  ClaudeCliEnvelope,
  extractJsonText,
  formatIssues,
  parseJson,
} from './claude-cli-reviewer.js'
import {
  CliExitFailedError,
  CliNotFoundError,
  CliResponseSchemaError,
  CliSpawnFailedError,
  CliTimeoutError,
  type VisionReviewerErrorContext,
} from './errors.js'
import { ReviewImage } from './port.js'

/**
 * 作った画像を Claude CLI に見せてチェックする（ADR-0055）。作りは動画のレビュア（`claude-cli-reviewer.ts`）と同じ:
 * 画像は手元のファイルパスで渡し、Read だけを許し、絵を置いた一時ディレクトリを作業場所にする。
 * 応答は `ImageCheckResult` で検査し、**通らなければ投げる**（呼ぶ側が「チェックに失敗した」と残す）。
 */

export const CLAUDE_CLI_IMAGE_CHECKER_NAME = 'claude-cli-image-checker'

export const ImageCheckRequest = z.object({
  kind: z.custom<ImageJobKind>((value) => typeof value === 'string'),
  /** 作った絵。 */
  subject: ReviewImage,
  /** 作るときに渡した参照（キャラクター・Look・場所・作品の手本）。無ければ空。 */
  references: z.array(ReviewImage),
  /** 作るときの指示（英語）。 */
  instruction: z.string().min(1),
  imageDir: z.string().min(1),
})
export type ImageCheckRequest = z.infer<typeof ImageCheckRequest>

export type ImageCheckOutcomeWithCost = {
  readonly result: ImageCheckResult
  /** 実際に払った額。CLI が返さなければ 0（推測値を入れない）。 */
  readonly costUsd: number
}

/** 作った画像を見る口。実装は `@ixa/provider-llm` の中に閉じる。 */
export type ImageChecker = {
  readonly name: string
  check(request: ImageCheckRequest): Promise<ImageCheckOutcomeWithCost>
}

const WHAT: Readonly<Record<ImageJobKind, string>> = {
  start_frame: '動画の最初のフレームになる 1 枚の絵',
  character_sheet: '1 人のキャラクターの四面図（正面・側面・背面・斜めを横に並べた 1 枚）',
  key_art: 'YouTube のサムネイルの背景になる 1 枚の絵',
}

/**
 * 指示に書く長さ。**検査の上限より短く頼む**（実機で 500 字を超える直し方が返り、検査で落ちた。2026-10-19）。
 * 上限そのものは domain の値。ここは余裕を持たせた頼み方だけ。
 */
const ISSUE_HINT = Math.floor(IMAGE_CHECK_ISSUE_MESSAGE_MAX_LENGTH / 2)
const DELTA_HINT = Math.floor(IMAGE_CHECK_PROMPT_DELTA_MAX_LENGTH / 2)

const imageLines = (title: string, images: readonly ReviewImage[]): string =>
  images.length === 0 ? `${title}: なし` : [`${title}:`, ...images.map((image) => `- ${image.label}: ${image.path}`)].join('\n')

/**
 * チェックの指示。**判定は甘めに書く**（やり直しすぎて手元の GPU を占有しないことを優先する。ADR-0055 §1）。
 * テストのために公開する。
 */
export const buildImageCheckPrompt = (request: ImageCheckRequest): string =>
  [
    `あなたは画像生成の検品係です。判定するのは${WHAT[request.kind]}です。`,
    '画像は手元のファイルです。Read で開いて見てください（ほかのファイルは開かないでください）。',
    '',
    imageLines('判定する絵', [request.subject]),
    '',
    imageLines('参照画像', request.references),
    '',
    '絵を作ったときの指示:',
    request.instruction,
    '',
    '見るのは次の 2 つだけです。',
    '- 破綻: 手足・指・顔の崩れ（anatomy）、溶けた物・混ざった物（artifact）、意味の無い文字や崩れた文字（text）',
    '- 矛盾: 指示の主要素の欠落（prompt）、参照画像の人物と明らかに別人（identity）、服装や色が参照と明らかに違う（look）、',
    '  頭身・等身・体型のバランスが参照と違う（proportion）',
    '- 文字に関することは、指示で禁じられていても text で挙げてください（prompt にしない）。',
    '',
    '判定の厳しさ:',
    '- "retry" は誰が見てもリテイクのときだけ: 指の数がおかしい、手足や顔が崩れている、物が溶けている、',
    '  明らかに別人、服や色が明らかに違う、指示の主要素が欠けている',
    '- 意味の無い文字（看板・画面・服のプリントなど）だけなら "review"。描き直しても直らないため',
    '- 頭身の違い（proportion）だけなら "review"。デフォルメは作品の画風として意図したもの',
    '- 好みの問題（構図・光・色味・表情の良し悪し）や、小さくて気にならない崩れは "review" か "pass"',
    '- 迷ったら "pass" か "review" にしてください。やり直しは手元の GPU を長く使います',
    '',
    '次の JSON だけを出力してください。前後に説明文を付けないでください。',
    '{',
    '  "verdict": "pass" | "review" | "retry",',
    '  "score": 0 以上 1 以下の数値（1 が申し分ない）,',
    `  "issues": [{ "kind": "anatomy" | "artifact" | "text" | "identity" | "prompt" | "look" | "proportion", "message": 日本語の 1 文（${String(ISSUE_HINT)} 字以内） }],`,
    `  "promptDelta": やり直すときに指示へ足す英語の具体的な直し方（${String(DELTA_HINT)} 字以内の 1〜2 文）。直す点が無ければ null`,
    '}',
    '',
    `issues は ${String(IMAGE_CHECK_MAX_ISSUES)} 件まで。"retry" なら 1 件以上。問題が無ければ空の配列にしてください。`,
    '"pass" なら promptDelta は null にしてください。',
    'promptDelta に「頑張って」のような抽象的な指示を書かないでください。',
  ].join('\n')

const ClaudeCliImageCheckerOptions = z.object({
  name: z.string().min(1).default(CLAUDE_CLI_IMAGE_CHECKER_NAME),
  binary: z.string().min(1).default('claude'),
  timeoutMs: z.number().int().positive().default(DEFAULT_CLI_TIMEOUT_MS),
  model: z.string().min(1).nullable().default(null),
  permissionMode: z.string().min(1).nullable().default(null),
})

export type ClaudeCliImageCheckerOptions = {
  name?: string
  binary?: string
  timeoutMs?: number
  model?: string | null
  permissionMode?: string | null
  /** 実 CLI を叩かずに契約テストを書くための差し込み口。 */
  runner?: CliRunner
}

/** 手元の画像を開くために Read だけを許す。広げない。 */
const ALLOWED_TOOLS = ['Read'] as const

const stdoutOf = (run: CliRunResult, binary: string, context: VisionReviewerErrorContext): string => {
  switch (run.kind) {
    case 'not_found':
      throw new CliNotFoundError(binary, run.reason, context)
    case 'timeout':
      throw new CliTimeoutError(run.timeoutMs, context)
    case 'spawn_failed':
      throw new CliSpawnFailedError(run.reason, context)
    case 'completed':
      if (run.exitCode !== 0) throw new CliExitFailedError(run.exitCode, run.stderr, context)
      return run.stdout
  }
}

export const createClaudeCliImageChecker = (options: ClaudeCliImageCheckerOptions = {}): ImageChecker => {
  const { runner = execFileCliRunner, ...rest } = options
  const config = ClaudeCliImageCheckerOptions.parse(rest)

  const check = async (input: ImageCheckRequest): Promise<ImageCheckOutcomeWithCost> => {
    const request = ImageCheckRequest.parse(input)
    const prompt = buildImageCheckPrompt(request)
    const args = buildCliArgs({ prompt, model: config.model, allowedTools: ALLOWED_TOOLS, permissionMode: config.permissionMode })
    const context: VisionReviewerErrorContext = {
      reviewer: 'image_check',
      command: redactCommand(config.binary, args, prompt),
      adapter: config.name,
    }
    const run = await runner({ command: config.binary, args, timeoutMs: config.timeoutMs, cwd: request.imageDir }).catch(
      (error: unknown) => {
        throw new CliSpawnFailedError(error instanceof Error ? error.message : String(error), context, { cause: error })
      },
    )
    const stdout = stdoutOf(run, config.binary, context)

    const envelope = ClaudeCliEnvelope.safeParse(parseJson(stdout, 'envelope', context))
    if (!envelope.success) throw new CliResponseSchemaError('envelope', formatIssues(envelope.error), stdout, context)
    if (envelope.data.is_error === true) {
      throw new CliExitFailedError(0, `CLI が is_error を返しました: ${envelope.data.result}`, context)
    }
    const text = extractJsonText(envelope.data.result)
    const result = ImageCheckResult.safeParse(parseJson(text, 'result', context))
    if (!result.success) throw new CliResponseSchemaError('result', formatIssues(result.error), text, context)
    return { result: result.data, costUsd: envelope.data.total_cost_usd ?? 0 }
  }

  return { name: config.name, check }
}
