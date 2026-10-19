import { describe, expect, it } from 'vitest'
import {
  buildImageCheckPrompt,
  CLAUDE_CLI_IMAGE_CHECKER_NAME,
  createClaudeCliImageChecker,
  type ImageCheckRequest,
} from '../claude-cli-image-checker.js'
import type { CliRunner } from '../claude-cli-reviewer.js'
import { CliExitFailedError, CliResponseNotJsonError, CliResponseSchemaError } from '../errors.js'
import { completedWith, envelope, IMAGE_DIR, recordingRunner } from './fixtures.js'

/**
 * 作った画像のチェック（ADR-0055）。**実 CLI を CI で叩かない**（ADR-0012）。モック応答で契約を固定する。
 */

const request = (patch: Partial<ImageCheckRequest> = {}): ImageCheckRequest => ({
  kind: 'start_frame',
  subject: { label: '作った絵', path: `${IMAGE_DIR}/subject.png` },
  references: [{ label: '参照 1', path: `${IMAGE_DIR}/ref-1.png` }],
  instruction: 'A girl in a red jacket running on a rainy street at night.',
  imageDir: IMAGE_DIR,
  ...patch,
})

const valid = {
  verdict: 'retry',
  score: 0.25,
  issues: [{ kind: 'anatomy', message: '右手の指が 6 本あります' }],
  promptDelta: 'exactly five fingers on each hand',
}

const okRunner = (text: string): CliRunner => () => Promise.resolve(completedWith(envelope(text)))

describe('Claude CLI の画像チェックの正常系', () => {
  it('二重 JSON を解き、判定と実測の費用を返す', async () => {
    const outcome = await createClaudeCliImageChecker({ runner: okRunner(JSON.stringify(valid)) }).check(request())
    expect(outcome.result).toEqual(valid)
    expect(outcome.costUsd).toBe(0.0123)
  })

  it('```json のフェンスで包まれていても解ける', async () => {
    const fenced = '```json\n' + JSON.stringify(valid) + '\n```'
    const outcome = await createClaudeCliImageChecker({ runner: okRunner(fenced) }).check(request())
    expect(outcome.result.verdict).toBe('retry')
  })

  it('画像の置き場を作業場所にし、Read だけを許す', async () => {
    const { runner, calls } = recordingRunner(completedWith(envelope(JSON.stringify(valid))))
    const checker = createClaudeCliImageChecker({ runner })
    await checker.check(request())
    expect(checker.name).toBe(CLAUDE_CLI_IMAGE_CHECKER_NAME)
    expect(calls[0]?.cwd).toBe(IMAGE_DIR)
    const args = calls[0]?.args ?? []
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('Read')
  })
})

describe('Claude CLI の画像チェックのプロンプト', () => {
  it('作った絵・参照・指示・出力の形を載せる', () => {
    const prompt = buildImageCheckPrompt(request())
    expect(prompt).toContain(`${IMAGE_DIR}/subject.png`)
    expect(prompt).toContain(`${IMAGE_DIR}/ref-1.png`)
    expect(prompt).toContain('A girl in a red jacket')
    expect(prompt).toContain('"verdict"')
    expect(prompt).toContain('"promptDelta"')
  })

  it('甘めの判定を言う（好みの問題ではやり直さない）', () => {
    const prompt = buildImageCheckPrompt(request())
    expect(prompt).toMatch(/指の数/)
    expect(prompt).toMatch(/好み/)
  })

  it('参照が無ければ「なし」と書く', () => {
    expect(buildImageCheckPrompt(request({ references: [] }))).toMatch(/参照画像: なし/)
  })

  it('キャラクターシートは並べた絵として見る', () => {
    expect(buildImageCheckPrompt(request({ kind: 'character_sheet' }))).toMatch(/四面図/)
  })
})

describe('Claude CLI の画像チェックの異常系（とりあえず通さない）', () => {
  it('範囲を破る点は形の違いとして投げる', async () => {
    const broken = JSON.stringify({ ...valid, score: 1.5 })
    await expect(createClaudeCliImageChecker({ runner: okRunner(broken) }).check(request())).rejects.toBeInstanceOf(
      CliResponseSchemaError,
    )
  })

  it('理由の無いやり直しは投げる', async () => {
    const broken = JSON.stringify({ ...valid, issues: [] })
    await expect(createClaudeCliImageChecker({ runner: okRunner(broken) }).check(request())).rejects.toBeInstanceOf(
      CliResponseSchemaError,
    )
  })

  it('JSON でなければ投げる', async () => {
    await expect(createClaudeCliImageChecker({ runner: okRunner('よさそうです') }).check(request())).rejects.toBeInstanceOf(
      CliResponseNotJsonError,
    )
  })

  it('終了コードが 0 でなければ投げる', async () => {
    const runner: CliRunner = () => Promise.resolve({ kind: 'completed', exitCode: 1, stdout: '', stderr: 'boom' })
    await expect(createClaudeCliImageChecker({ runner }).check(request())).rejects.toBeInstanceOf(CliExitFailedError)
  })
})

describe('Claude CLI の画像チェックの長さの頼み方', () => {
  /** 実機で 500 字を超える直し方が返り、検査で落ちた（2026-10-19）。上限より短く頼む。 */
  it('理由と直し方の長さを、検査の上限より短く頼む', () => {
    const prompt = buildImageCheckPrompt(request())
    expect(prompt).toContain('100 字以内')
    expect(prompt).toContain('250 字以内')
    expect(prompt).toMatch(/"pass" なら promptDelta は null/)
  })
})

/** チームリーダー 2026-10-19。文字と頭身ではやり直さない（判定は domain の規則でも強制する）。 */
describe('Claude CLI の画像チェックの厳しさ', () => {
  it('文字と頭身は「やり直す」にしないと言い、頭身は proportion で挙げさせる', () => {
    const prompt = buildImageCheckPrompt(request())
    expect(prompt).toContain('"proportion"')
    expect(prompt).toMatch(/意味の無い文字.*"review"/)
    expect(prompt).toMatch(/頭身.*proportion/)
    expect(prompt).not.toMatch(/"retry" は[^\n]*意味の無い文字/)
  })

  it('文字は、指示で禁じられていても text で挙げさせる（prompt にしない）', () => {
    expect(buildImageCheckPrompt(request())).toMatch(/文字.*指示で禁じられていても.*text/)
  })
})

/** チェックだけに効くモデルの指定（ADR-0055 追記）。渡したときだけ --model を付ける。 */
describe('Claude CLI の画像チェックのモデル', () => {
  it('モデルを渡せば --model で指定し、渡さなければ付けない', async () => {
    const withModel = recordingRunner(completedWith(envelope(JSON.stringify(valid))))
    await createClaudeCliImageChecker({ runner: withModel.runner, model: 'sonnet' }).check(request())
    const args = withModel.calls[0]?.args ?? []
    expect(args[args.indexOf('--model') + 1]).toBe('sonnet')

    const without = recordingRunner(completedWith(envelope(JSON.stringify(valid))))
    await createClaudeCliImageChecker({ runner: without.runner }).check(request())
    expect(without.calls[0]?.args).not.toContain('--model')
  })
})
