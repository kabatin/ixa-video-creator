import type { ReviewerType } from '@ixa/domain'

/**
 * vision LLM レビュアのエラー分類。
 *
 * 呼び出し側（再生成ループ）は「CLI が無い」と「応答が壊れている」を**別の事故として**
 * 扱う必要がある。前者は環境の不備でリトライしても直らず、後者はリトライで直りうる。
 * `instanceof` を書かずに分岐できるよう、コードを discriminant として持たせている。
 */
export const VISION_REVIEWER_ERROR_CODES = [
  'unsupported_reviewer',
  'cli_not_found',
  'cli_spawn_failed',
  'cli_timeout',
  'cli_exit_failed',
  'response_not_json',
  'response_schema_violation',
] as const
export type VisionReviewerErrorCode = (typeof VISION_REVIEWER_ERROR_CODES)[number]

/** リトライしても直らないエラー。呼び出し側が無駄な再試行をしないための分類。 */
const NON_RETRYABLE: readonly VisionReviewerErrorCode[] = Object.freeze([
  'unsupported_reviewer',
  'cli_not_found',
  'cli_spawn_failed',
])

/** どの応答段でのエラーかを区別する。CLI の外枠 JSON と、その中の判定 JSON は別物。 */
export type ResponseStage = 'envelope' | 'result'

/**
 * すべてのエラーに必ず付ける文脈。
 *
 * `command` は**プロンプト本文を伏せた**形で渡すこと。プロンプトには都度発行した
 * 署名付き URL が含まれており、そのままログへ流すと CLAUDE.md 規約 7 の意図に反する。
 */
export type VisionReviewerErrorContext = {
  readonly reviewer: ReviewerType
  /** 実行したコマンド（プロンプト本文は伏字）。何を叩いて失敗したかを残すため。 */
  readonly command: string
  /** どのアダプタが投げたか。複数のレビュアを並べたときに発生源を特定するため。 */
  readonly adapter: string
}

/** ログと例外メッセージに長大な stdout を流し込まないための切り詰め。 */
export const MAX_EXCERPT_LENGTH = 400

export const excerpt = (value: string, maxLength: number = MAX_EXCERPT_LENGTH): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength)}…(${value.length} 文字)`

export class VisionReviewerError extends Error {
  readonly code: VisionReviewerErrorCode
  readonly reviewer: ReviewerType
  readonly command: string
  readonly adapter: string

  constructor(
    code: VisionReviewerErrorCode,
    summary: string,
    context: VisionReviewerErrorContext,
    options?: ErrorOptions,
  ) {
    super(
      `${summary}（adapter=${context.adapter} / reviewer=${context.reviewer} / command=${context.command}）`,
      options,
    )
    this.name = 'VisionReviewerError'
    this.code = code
    this.reviewer = context.reviewer
    this.command = context.command
    this.adapter = context.adapter
  }

  /** 同じ入力で再試行する価値があるか。 */
  get retryable(): boolean {
    return !NON_RETRYABLE.includes(this.code)
  }
}

/** このアダプタが扱えないレビュア種別を渡された。ルータの配線ミス。 */
export class UnsupportedReviewerError extends VisionReviewerError {
  readonly supports: readonly ReviewerType[]

  constructor(supports: readonly ReviewerType[], context: VisionReviewerErrorContext) {
    super(
      'unsupported_reviewer',
      `レビュア種別 ${context.reviewer} を扱えません（対応: ${supports.join(', ')}）`,
      context,
    )
    this.name = 'UnsupportedReviewerError'
    this.supports = [...supports]
  }
}

/** 実行ファイルが見つからない。環境の不備であり、リトライでは直らない。 */
export class CliNotFoundError extends VisionReviewerError {
  readonly binary: string

  constructor(binary: string, reason: string, context: VisionReviewerErrorContext) {
    super('cli_not_found', `CLI ${binary} が見つかりません: ${reason}`, context)
    this.name = 'CliNotFoundError'
    this.binary = binary
  }
}

/** 見つかったが起動できなかった。権限・実行形式などの環境要因。 */
export class CliSpawnFailedError extends VisionReviewerError {
  constructor(reason: string, context: VisionReviewerErrorContext, options?: ErrorOptions) {
    super('cli_spawn_failed', `CLI を起動できませんでした: ${reason}`, context, options)
    this.name = 'CliSpawnFailedError'
  }
}

/** 制限時間内に終わらなかった。ハングした CLI がキューを詰まらせる事故（ADR-0012）。 */
export class CliTimeoutError extends VisionReviewerError {
  readonly timeoutMs: number

  constructor(timeoutMs: number, context: VisionReviewerErrorContext) {
    super('cli_timeout', `CLI が ${timeoutMs}ms 以内に終了しませんでした`, context)
    this.name = 'CliTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

/** 起動して終了したが、失敗として終わった。exit code を先に見てから出力を解釈する。 */
export class CliExitFailedError extends VisionReviewerError {
  readonly exitCode: number
  readonly stderrExcerpt: string

  constructor(
    exitCode: number,
    stderrText: string,
    context: VisionReviewerErrorContext,
  ) {
    super(
      'cli_exit_failed',
      `CLI が異常終了しました（exit=${exitCode}): ${excerpt(stderrText)}`,
      context,
    )
    this.name = 'CliExitFailedError'
    this.exitCode = exitCode
    this.stderrExcerpt = excerpt(stderrText)
  }
}

/** JSON として読めなかった。`stage` で外枠と判定本体のどちらが壊れたかを区別する。 */
export class CliResponseNotJsonError extends VisionReviewerError {
  readonly stage: ResponseStage
  readonly responseExcerpt: string

  constructor(
    stage: ResponseStage,
    responseText: string,
    context: VisionReviewerErrorContext,
    options?: ErrorOptions,
  ) {
    super(
      'response_not_json',
      `CLI の応答（${stage}）が JSON として読めません: ${excerpt(responseText)}`,
      context,
      options,
    )
    this.name = 'CliResponseNotJsonError'
    this.stage = stage
    this.responseExcerpt = excerpt(responseText)
  }
}

/**
 * JSON ではあったが契約を満たさなかった。
 * **「とりあえず通す」ことはしない**（port.ts の方針）。何が欠けたかを issues に残す。
 */
export class CliResponseSchemaError extends VisionReviewerError {
  readonly stage: ResponseStage
  readonly issues: readonly string[]
  readonly responseExcerpt: string

  constructor(
    stage: ResponseStage,
    issues: readonly string[],
    responseText: string,
    context: VisionReviewerErrorContext,
  ) {
    super(
      'response_schema_violation',
      `CLI の応答（${stage}）がスキーマに適合しません: ${issues.join(' / ')}`,
      context,
    )
    this.name = 'CliResponseSchemaError'
    this.stage = stage
    this.issues = [...issues]
    this.responseExcerpt = excerpt(responseText)
  }
}
