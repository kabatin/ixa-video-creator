import { describe, expect, it } from 'vitest'
import {
  buildMotionPrompt,
  CLAUDE_CLI_MOTION_ANALYZER_NAME,
  createClaudeCliMotionAnalyzer,
  type MotionVisionRequest,
} from '../claude-cli-motion-analyzer.js'
import type { CliRunner } from '../claude-cli-reviewer.js'
import { CliExitFailedError, CliResponseNotJsonError, CliResponseSchemaError } from '../errors.js'
import { completedWith, envelope, IMAGE_DIR, recordingRunner } from './fixtures.js'

/** Take の動きを Claude CLI に見せる（ADR-0054 §3）。実 CLI を CI で叩かない。モック応答で契約を固定する。 */

const request = (patch: Partial<MotionVisionRequest> = {}): MotionVisionRequest => ({
  strip: { label: 'コマの帯', path: `${IMAGE_DIR}/strip.jpg` },
  columns: 4,
  frameTimesSec: [0.3, 0.9, 1.5, 2.1],
  takeDurationSec: 2.4,
  onsets: [{ atSec: 1.0, strength: 1 }, { atSec: 1.6, strength: 0.4 }],
  segments: [{ startSec: 0.5, endSec: 2 }],
  description: '戦子が店の通路で跳ねる',
  imageDir: IMAGE_DIR,
  ...patch,
})

const valid = {
  events: [
    {
      kind: 'moment',
      takeStartSec: 1.0,
      takeDurationSec: 0.4,
      label: '着地',
      sfxPrompt: 'cartoon boing bounce landing',
      confidence: 0.8,
    },
  ],
}

const okRunner = (text: string): CliRunner => () => Promise.resolve(completedWith(envelope(text)))

describe('Claude CLI の動きの分析の正常系', () => {
  it('二重 JSON を解き、出来事と実測の費用を返す', async () => {
    const outcome = await createClaudeCliMotionAnalyzer({ runner: okRunner(JSON.stringify(valid)) }).analyze(request())
    expect(outcome.events).toEqual(valid.events)
    expect(outcome.costUsd).toBe(0.0123)
  })

  it('画像の置き場を作業場所にし、Read だけを許す', async () => {
    const { runner, calls } = recordingRunner(completedWith(envelope(JSON.stringify(valid))))
    const analyzer = createClaudeCliMotionAnalyzer({ runner })
    await analyzer.analyze(request())
    expect(analyzer.name).toBe(CLAUDE_CLI_MOTION_ANALYZER_NAME)
    expect(calls[0]?.cwd).toBe(IMAGE_DIR)
    const args = calls[0]?.args ?? []
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('Read')
  })
})

describe('Claude CLI の動きの分析のプロンプト', () => {
  it('帯の画像・各コマの時刻・山の時刻・Shot の説明を載せる', () => {
    const prompt = buildMotionPrompt(request())
    expect(prompt).toContain(`${IMAGE_DIR}/strip.jpg`)
    expect(prompt).toContain('1 段目の左から 1 枚目: 0.30 秒')
    expect(prompt).toContain('1.00 秒（強さ 1.00）')
    expect(prompt).toContain('戦子が店の通路で跳ねる')
    expect(prompt).toContain('"moment" | "sustained" | "pass_by" | "ambient"')
  })
})

describe('Claude CLI の動きの分析の異常系', () => {
  it('JSON でない応答は投げる', async () => {
    await expect(createClaudeCliMotionAnalyzer({ runner: okRunner('跳ねています') }).analyze(request())).rejects.toBeInstanceOf(
      CliResponseNotJsonError,
    )
  })

  it.each([
    ['知らない種類', { events: [{ ...valid.events[0], kind: 'explosion' }] }],
    ['日本語の音の指示', { events: [{ ...valid.events[0], sfxPrompt: '足音' }] }],
    ['events が無い', {}],
  ])('%s は形の違反として投げる', async (_, body) => {
    await expect(
      createClaudeCliMotionAnalyzer({ runner: okRunner(JSON.stringify(body)) }).analyze(request()),
    ).rejects.toBeInstanceOf(CliResponseSchemaError)
  })

  it('CLI の異常終了は投げる', async () => {
    const failing: CliRunner = () => Promise.resolve({ kind: 'completed', exitCode: 1, stdout: '', stderr: 'boom' })
    await expect(createClaudeCliMotionAnalyzer({ runner: failing }).analyze(request())).rejects.toBeInstanceOf(
      CliExitFailedError,
    )
  })

  it('コマの時刻が無い頼みは投げる（帯の読み方を伝えられない）', async () => {
    await expect(
      createClaudeCliMotionAnalyzer({ runner: okRunner(JSON.stringify(valid)) }).analyze(request({ frameTimesSec: [] })),
    ).rejects.toThrow()
  })
})
