import { describe, expect, it } from 'vitest'
import {
  buildCliArgs,
  buildReviewPrompt,
  createClaudeCliVisionReviewer,
  extractJsonText,
  redactCommand,
  CLAUDE_CLI_REVIEWER_NAME,
  DEFAULT_CLI_TIMEOUT_MS,
  type CliRunner,
} from '../claude-cli-reviewer.js'
import {
  CliExitFailedError,
  CliNotFoundError,
  CliResponseNotJsonError,
  CliResponseSchemaError,
  CliSpawnFailedError,
  CliTimeoutError,
  UnsupportedReviewerError,
} from '../errors.js'
import {
  completedWith,
  envelope,
  IMAGE_DIR,
  makeReviewRequest,
  recordingRunner,
  validResult,
} from './fixtures.js'

/**
 * **実 CLI を CI で叩かない**（ADR-0004 / ADR-0012）。
 * サブプロセス実行はポートとして注入し、モック応答で契約を固定する。
 */
const reviewerWith = (runner: CliRunner) => createClaudeCliVisionReviewer({ runner })

const okRunner = (resultText: string, extra?: Readonly<Record<string, unknown>>): CliRunner =>
  () => Promise.resolve(completedWith(envelope(resultText, extra)))

describe('Claude CLI vision レビュアの正常系', () => {
  it('二重 JSON を解いて VisionReviewResult と実測コストを返す', async () => {
    const outcome = await reviewerWith(okRunner(JSON.stringify(validResult))).review(
      makeReviewRequest(),
    )

    expect(outcome.result).toEqual(validResult)
    expect(outcome.costUsd).toBe(0.0123)
  })

  it('```json フェンスで包まれていても解ける', async () => {
    const fenced = '```json\n' + JSON.stringify(validResult) + '\n```'
    const outcome = await reviewerWith(okRunner(fenced)).review(makeReviewRequest())

    expect(outcome.result.severity).toBe('fail')
  })

  it('total_cost_usd が無ければ 0 を返す（推測値を入れない）', async () => {
    const runner: CliRunner = () =>
      Promise.resolve(completedWith(JSON.stringify({ result: JSON.stringify(validResult) })))

    expect((await reviewerWith(runner).review(makeReviewRequest())).costUsd).toBe(0)
  })

  it('既定の名前・対応レビュア・タイムアウトを持つ', async () => {
    const { runner, calls } = recordingRunner(completedWith(envelope(JSON.stringify(validResult))))
    const reviewer = createClaudeCliVisionReviewer({ runner })
    await reviewer.review(makeReviewRequest())

    expect(reviewer.name).toBe(CLAUDE_CLI_REVIEWER_NAME)
    expect([...reviewer.supports]).toContain('identity')
    expect(calls[0]?.timeoutMs).toBe(DEFAULT_CLI_TIMEOUT_MS)
    expect(calls[0]?.command).toBe('claude')
  })
})

describe('Claude CLI vision レビュアのプロンプトと引数', () => {
  it('プロンプトに判定基準・ラベル・画像のファイル・出力契約を載せる', () => {
    const prompt = buildReviewPrompt(makeReviewRequest())

    expect(prompt).toContain('identity')
    expect(prompt).toContain('主役の顔が参照画像と一致していること')
    expect(prompt).toContain(`frame@1.5s: ${IMAGE_DIR}/frame-0.jpg`)
    expect(prompt).toContain('reference:face_front')
    expect(prompt).toContain('Read')
    expect(prompt).toContain('"suggestedPromptDelta"')
  })

  /**
   * 画像は手元のファイルを Read で開く（2026-10-02）。以前は署名付き URL を WebFetch で読ませていたが、
   * 手元の保管庫（MinIO）は外から読めず、署名付き URL を外の AI へ出すことにもなっていた（規約 7）。
   */
  it('画像の置き場を作業場所にして、Read だけを許して呼ぶ', async () => {
    const { calls, runner } = recordingRunner({
      kind: 'completed',
      exitCode: 0,
      stdout: envelope(JSON.stringify(validResult)),
      stderr: '',
    })

    await reviewerWith(runner).review(makeReviewRequest())

    expect(calls[0]?.cwd).toBe(IMAGE_DIR)
    const args = calls[0]?.args ?? []
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('Read')
    expect(args.join(' ')).not.toContain('WebFetch')
  })

  it('比較対象が無ければ「なし」と明示する', () => {
    expect(buildReviewPrompt(makeReviewRequest({ references: [] }))).toContain('比較対象: なし')
  })

  it('--output-format json を必ず付け、model / permission-mode は指定時のみ付ける', () => {
    const base = buildCliArgs({ prompt: 'p', model: null, allowedTools: [], permissionMode: null })
    expect([...base]).toEqual(['-p', 'p', '--output-format', 'json'])

    const full = buildCliArgs({
      prompt: 'p',
      model: 'claude-opus-5',
      allowedTools: ['WebFetch'],
      permissionMode: 'acceptEdits',
    })
    expect([...full]).toEqual([
      '-p', 'p',
      '--output-format', 'json',
      '--allowedTools', 'WebFetch',
      '--permission-mode', 'acceptEdits',
      '--model', 'claude-opus-5',
    ])
  })

  it('エラーに載せるコマンドはプロンプト本文を含まない', async () => {
    const runner: CliRunner = () => Promise.resolve({ kind: 'timeout', timeoutMs: 1000 })
    const error = await reviewerWith(runner)
      .review(makeReviewRequest())
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(CliTimeoutError)
    expect((error as Error).message).not.toContain('frame-0.jpg')
    expect((error as Error).message).toContain('<prompt:')
  })

  it('redactCommand はプロンプト引数だけを伏せる', () => {
    const redacted = redactCommand('claude', ['-p', 'secret?sig=abc', '--output-format', 'json'], 'secret?sig=abc')

    expect(redacted).not.toContain('sig=abc')
    expect(redacted).toContain('--output-format json')
  })

  it('extractJsonText はフェンスだけを外し、素の JSON はそのまま返す', () => {
    expect(extractJsonText('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(extractJsonText('```\n{"a":1}\n```')).toBe('{"a":1}')
    expect(extractJsonText('  {"a":1}  ')).toBe('{"a":1}')
  })
})

describe('Claude CLI vision レビュアのエラー分類', () => {
  const failing = async (runner: CliRunner): Promise<unknown> =>
    reviewerWith(runner)
      .review(makeReviewRequest())
      .catch((caught: unknown) => caught)

  it('CLI が無い場合は cli_not_found（リトライ不可）', async () => {
    const error = await failing(() => Promise.resolve({ kind: 'not_found', reason: 'ENOENT claude' }))

    expect(error).toBeInstanceOf(CliNotFoundError)
    expect(error).toMatchObject({ code: 'cli_not_found', retryable: false, binary: 'claude' })
    expect((error as Error).message).toContain('reviewer=identity')
  })

  it('起動できなければ cli_spawn_failed', async () => {
    const error = await failing(() => Promise.resolve({ kind: 'spawn_failed', reason: 'EACCES' }))

    expect(error).toBeInstanceOf(CliSpawnFailedError)
    expect(error).toMatchObject({ code: 'cli_spawn_failed', retryable: false })
  })

  it('タイムアウトは cli_timeout（リトライ可）', async () => {
    const error = await failing(() => Promise.resolve({ kind: 'timeout', timeoutMs: 600_000 }))

    expect(error).toBeInstanceOf(CliTimeoutError)
    expect(error).toMatchObject({ code: 'cli_timeout', timeoutMs: 600_000, retryable: true })
  })

  it('異常終了は exit code と stderr を残す', async () => {
    const error = await failing(() =>
      Promise.resolve({ kind: 'completed', exitCode: 2, stdout: '', stderr: 'usage error' }),
    )

    expect(error).toBeInstanceOf(CliExitFailedError)
    expect(error).toMatchObject({ code: 'cli_exit_failed', exitCode: 2, stderrExcerpt: 'usage error' })
  })

  it('is_error を返した応答も異常終了として扱う', async () => {
    const error = await failing(() =>
      Promise.resolve(completedWith(envelope('rate limited', { is_error: true }))),
    )

    expect(error).toBeInstanceOf(CliExitFailedError)
    expect((error as Error).message).toContain('is_error')
  })

  it('外枠が JSON でなければ stage=envelope', async () => {
    const error = await failing(() => Promise.resolve(completedWith('not json at all')))

    expect(error).toBeInstanceOf(CliResponseNotJsonError)
    expect(error).toMatchObject({ code: 'response_not_json', stage: 'envelope' })
    expect((error as Error).cause).toBeInstanceOf(SyntaxError)
  })

  it('外枠に result が無ければ stage=envelope のスキーマ違反', async () => {
    const error = await failing(() => Promise.resolve(completedWith('{"session_id":"abc"}')))

    expect(error).toBeInstanceOf(CliResponseSchemaError)
    expect(error).toMatchObject({ code: 'response_schema_violation', stage: 'envelope' })
  })

  it('判定本体が JSON でなければ stage=result', async () => {
    const error = await failing(okRunner('だいたい良い感じだと思います'))

    expect(error).toBeInstanceOf(CliResponseNotJsonError)
    expect(error).toMatchObject({ stage: 'result' })
  })

  it('score が値域外なら通さない（「とりあえず通す」ことをしない）', async () => {
    const error = await failing(okRunner(JSON.stringify({ ...validResult, score: 1.5 })))

    expect(error).toBeInstanceOf(CliResponseSchemaError)
    expect(error).toMatchObject({ stage: 'result' })
    expect((error as CliResponseSchemaError).issues.join()).toContain('score')
  })

  it('severity が enum 外でも、必須項目が欠けても通さない', async () => {
    const badSeverity = await failing(okRunner(JSON.stringify({ ...validResult, severity: 'ok' })))
    const missing = await failing(okRunner(JSON.stringify({ severity: 'info', score: 1 })))

    expect(badSeverity).toBeInstanceOf(CliResponseSchemaError)
    expect(missing).toBeInstanceOf(CliResponseSchemaError)
    expect((missing as CliResponseSchemaError).issues.join()).toContain('message')
  })

  it('注入した runner が想定外に throw しても文脈を付けて載せ替える', async () => {
    const boom = new Error('socket hang up')
    const error = await failing(() => Promise.reject(boom))

    expect(error).toBeInstanceOf(CliSpawnFailedError)
    expect((error as Error).cause).toBe(boom)
    expect((error as Error).message).toContain('socket hang up')
  })

  it('対応外のレビュア種別では CLI を起動しない', async () => {
    const { runner, calls } = recordingRunner(completedWith(envelope(JSON.stringify(validResult))))
    const promise = createClaudeCliVisionReviewer({ runner }).review(
      makeReviewRequest({ reviewer: 'technical' }),
    )

    await expect(promise).rejects.toBeInstanceOf(UnsupportedReviewerError)
    expect(calls).toHaveLength(0)
  })

  it('不正な設定は生成時点で弾く', () => {
    expect(() => createClaudeCliVisionReviewer({ binary: '' })).toThrow()
    expect(() => createClaudeCliVisionReviewer({ timeoutMs: 0 })).toThrow()
    expect(() => createClaudeCliVisionReviewer({ supports: [] })).toThrow()
  })

  it('不正な判定依頼は CLI を起動する前に弾く', async () => {
    const { runner, calls } = recordingRunner(completedWith(envelope(JSON.stringify(validResult))))
    await expect(
      createClaudeCliVisionReviewer({ runner }).review(makeReviewRequest({ subjects: [] })),
    ).rejects.toThrow()

    expect(calls).toHaveLength(0)
  })
})
