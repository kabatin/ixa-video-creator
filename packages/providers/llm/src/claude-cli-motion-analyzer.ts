import { MOTION_EVENTS_MAX, MotionEvent, MotionOnset, Seconds } from '@ixa/domain'
import { z } from 'zod'
import { DEFAULT_CLI_TIMEOUT_MS, execFileCliRunner, redactCommand, type CliRunResult, type CliRunner } from '@ixa/provider-core'
import { buildCliArgs, ClaudeCliEnvelope, extractJsonText, formatIssues, parseJson } from './claude-cli-reviewer.js'
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
 * Take の動きを Claude CLI に見せて、何が起きているかを時刻付きで返させる（ADR-0054 §3）。
 * 作りは動画のレビュア（`claude-cli-reviewer.ts`）と同じ: 画像は手元のファイルパスで渡し、Read だけを許し、
 * 帯を置いた一時ディレクトリを作業場所にする。応答は zod で検査し、**通らなければ投げる**。
 */

export const CLAUDE_CLI_MOTION_ANALYZER_NAME = 'claude-cli-motion-analyzer'

export const MotionVisionRequest = z.object({
  /** 等間隔のコマを左上から右へ、段ごとに並べた 1 枚の帯。 */
  strip: ReviewImage,
  /** 帯の 1 段のコマ数。 */
  columns: z.number().int().positive(),
  /** 帯の各コマの Take の秒（並びの順）。 */
  frameTimesSec: z.array(Seconds).min(1),
  takeDurationSec: Seconds.positive(),
  /** 計算で取った動きの山。 */
  onsets: z.array(MotionOnset),
  /** 強い動きが続く区間（続く音の目安）。 */
  segments: z.array(z.object({ startSec: Seconds, endSec: Seconds })),
  /** Shot の説明（日本語のことが多い）。 */
  description: z.string(),
  imageDir: z.string().min(1),
})
export type MotionVisionRequest = z.infer<typeof MotionVisionRequest>

export const MotionVisionResult = z.object({ events: z.array(MotionEvent).max(MOTION_EVENTS_MAX) })
export type MotionVisionResult = z.infer<typeof MotionVisionResult>

export type MotionVisionOutcome = {
  readonly events: readonly MotionEvent[]
  /** 実際に払った額。CLI が返さなければ 0（推測値を入れない）。 */
  readonly costUsd: number
}

/** Take の動きを見る口。実装は `@ixa/provider-llm` の中に閉じる。 */
export type MotionVisionAnalyzer = {
  readonly name: string
  analyze(request: MotionVisionRequest): Promise<MotionVisionOutcome>
}

const sec = (value: number): string => value.toFixed(2)

const frameLines = (request: MotionVisionRequest): readonly string[] =>
  request.frameTimesSec.map((atSec, i) => {
    const row = Math.floor(i / request.columns) + 1
    const col = (i % request.columns) + 1
    return `- ${String(row)} 段目の左から ${String(col)} 枚目: ${sec(atSec)} 秒`
  })

const onsetLines = (request: MotionVisionRequest): readonly string[] =>
  request.onsets.length === 0
    ? ['- なし（目立った動きの変化がありません）']
    : request.onsets.map((onset) => `- ${sec(onset.atSec)} 秒（強さ ${onset.strength.toFixed(2)}）`)

const segmentLines = (request: MotionVisionRequest): readonly string[] =>
  request.segments.length === 0
    ? ['- なし']
    : request.segments.map((segment) => `- ${sec(segment.startSec)}〜${sec(segment.endSec)} 秒`)

/** 判定の指示。**自由文を返させない**ため、出力の形と値の範囲まで書く。テストのために公開する。 */
export const buildMotionPrompt = (request: MotionVisionRequest): string =>
  [
    'あなたは映像の効果音を付ける音響係です。動画のコマを並べた 1 枚の画像を見て、効果音を鳴らす出来事を時刻付きで挙げてください。',
    '画像は手元のファイルです。Read で開いて見てください（ほかのファイルは開かないでください）。',
    '',
    `コマの帯: ${request.strip.path}`,
    `動画の長さは ${sec(request.takeDurationSec)} 秒です。帯のコマは左上から右へ、段ごとに時刻順に並んでいます:`,
    ...frameLines(request),
    '',
    'シーンの説明:',
    request.description.trim() === '' ? '（説明なし）' : request.description,
    '',
    '計算で取った「動きが急に増えた瞬間」（着地・衝撃・足が地面に着くなどの候補。帯のコマより細かい時刻です）:',
    ...onsetLines(request),
    '',
    '強い動きが続く区間:',
    ...segmentLines(request),
    '',
    '出来事の種類:',
    '- "moment": 瞬間の音（衝撃・着地・足音・バックファイア・物が当たる）。足音や跳ねる着地は 1 回ずつ別の出来事にする',
    '- "sustained": 続く音（タイヤのスキール・エンジン・水しぶき・燃える音）',
    '- "pass_by": 通り過ぎる音（風切り・車や電車が通り過ぎる）',
    '- "ambient": その場の環境音（雑踏・風・波・雨）。1 つの動画に多くても 1 つ',
    '',
    '時刻の決め方:',
    '- 瞬間の時刻は、上の「動きが急に増えた瞬間」の中から、帯のコマで起きていることに合うものを選んでください',
    '- 跳ねる・歩く・走る・踊るなど**繰り返す動き**の区間では、その区間にある山の 1 つ 1 つを別々の瞬間（着地・足音）として挙げてください。',
    '  帯のコマは粗いので着地の瞬間が写っていないことがありますが、繰り返す動きの区間の山は、ほぼすべてが着地か足音です',
    '- 帯で何も起きていない山（カメラの揺れ・光のちらつき）は選ばないでください',
    '- 効果音が要らない動画なら、空の配列で構いません',
    '',
    '次の JSON だけを出力してください。前後に説明文を付けないでください。',
    '{',
    '  "events": [{',
    '    "kind": "moment" | "sustained" | "pass_by" | "ambient",',
    `    "takeStartSec": 0 以上 ${sec(request.takeDurationSec)} 未満の秒,`,
    '    "takeDurationSec": 音の長さの秒（瞬間は 0.2〜1 程度、続く音は続く長さ）,',
    '    "label": 日本語の短い名前（「着地」「スキール」など。40 文字まで）,',
    '    "sfxPrompt": 効果音の AI に渡す英語の具体的な説明（素材・強さ・響きを書く。例: "soft sneaker footstep on wooden shop floor"）,',
    '    "confidence": 0 以上 1 以下の確からしさ',
    '  }]',
    '}',
    '',
    `events は ${String(MOTION_EVENTS_MAX)} 件まで。時刻順に並べてください。sfxPrompt は必ず英語だけで書いてください。`,
  ].join('\n')

const ClaudeCliMotionAnalyzerOptions = z.object({
  name: z.string().min(1).default(CLAUDE_CLI_MOTION_ANALYZER_NAME),
  binary: z.string().min(1).default('claude'),
  timeoutMs: z.number().int().positive().default(DEFAULT_CLI_TIMEOUT_MS),
  model: z.string().min(1).nullable().default(null),
  permissionMode: z.string().min(1).nullable().default(null),
})

export type ClaudeCliMotionAnalyzerOptions = {
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

export const createClaudeCliMotionAnalyzer = (options: ClaudeCliMotionAnalyzerOptions = {}): MotionVisionAnalyzer => {
  const { runner = execFileCliRunner, ...rest } = options
  const config = ClaudeCliMotionAnalyzerOptions.parse(rest)

  const analyze = async (input: MotionVisionRequest): Promise<MotionVisionOutcome> => {
    const request = MotionVisionRequest.parse(input)
    const prompt = buildMotionPrompt(request)
    const args = buildCliArgs({ prompt, model: config.model, allowedTools: ALLOWED_TOOLS, permissionMode: config.permissionMode })
    const context: VisionReviewerErrorContext = {
      reviewer: 'motion_analysis',
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
    const result = MotionVisionResult.safeParse(parseJson(text, 'result', context))
    if (!result.success) throw new CliResponseSchemaError('result', formatIssues(result.error), text, context)
    return { events: result.data.events, costUsd: envelope.data.total_cost_usd ?? 0 }
  }

  return { name: config.name, analyze }
}
