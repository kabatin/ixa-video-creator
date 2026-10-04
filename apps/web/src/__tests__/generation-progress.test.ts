import { describe, expect, it } from 'vitest'
import { formatApproxDuration, formatElapsed } from '@/lib/format-time'
import { describeActiveGeneration } from '@/lib/generation-progress'
import type { WireActiveGeneration } from '@/lib/generation-activity-api'

/**
 * 生成中の様子（制作者 2026-09-30「生成中です、と出ているだけでわかりづらい」）。
 * **どのモデルで・順番待ちか作成中か・どれだけ経ったか・目安はどれくらいか**を 1 行で言う。
 */

const at = (iso: string) => new Date(iso).getTime()

const running = (patch: Partial<WireActiveGeneration> = {}): WireActiveGeneration => ({
  jobId: 'job-1',
  shotId: 'shot-1',
  status: 'running',
  modelId: 'vpipe/minimax-h3-turbo-draft',
  modelLabel: 'MiniMax H3 Turbo 下書き（ローカル・無料）',
  estimatedLatencySec: 210,
  queuedAt: '2026-09-30T10:00:00.000Z',
  startedAt: '2026-09-30T10:00:05.000Z',
  providerStartedAt: '2026-09-30T10:00:05.000Z',
  attempt: 1,
  ...patch,
})

describe('formatElapsed / formatApproxDuration', () => {
  it('経過は分:秒（秒の小数は出さない）', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(151.9)).toBe('2:31')
    expect(formatElapsed(3725)).toBe('62:05')
    expect(formatElapsed(-3)).toBe('0:00')
  })

  it('目安は「約 N 秒」「約 N 分」', () => {
    expect(formatApproxDuration(45)).toBe('約 45 秒')
    expect(formatApproxDuration(210)).toBe('約 4 分')
    expect(formatApproxDuration(1500)).toBe('約 25 分')
  })
})

describe('describeActiveGeneration', () => {
  it('作成中は、モデル・経過・目安を言う（経過は生成先が作り始めた時刻から）', () => {
    const view = describeActiveGeneration(running(), at('2026-09-30T10:02:36Z'))

    expect(view.short).toBe('作成中 2:31 / 約 4 分')
    expect(view.long).toBe(
      'MiniMax H3 Turbo 下書き（ローカル・無料）で作成中です（経過 2:31 / 目安 約 4 分）。',
    )
    expect(view.overdue).toBe(false)
  })

  it('順番待ちは、待っていることと待った時間を言う（経過は頼んだ時刻から）', () => {
    const view = describeActiveGeneration(
      running({ status: 'queued', startedAt: null }),
      at('2026-09-30T10:00:42Z'),
    )

    expect(view.short).toBe('順番待ち 0:42')
    expect(view.long).toMatch(/^順番待ちです（0:42）。前の生成が終わるのを待っています。/)
    expect(view.long).toContain('MiniMax H3 Turbo 下書き（ローカル・無料）で作ります')
  })

  it('目安を大きく過ぎたら、そう言う（黙って待たせない）', () => {
    const view = describeActiveGeneration(running(), at('2026-09-30T10:10:05Z'))

    expect(view.overdue).toBe(true)
    expect(view.long).toMatch(/目安を大きく過ぎています/)
  })

  it('モデルや目安が分からないときは、分からないと書かずに言える分だけ言う', () => {
    const view = describeActiveGeneration(
      running({ modelLabel: null, estimatedLatencySec: null }),
      at('2026-09-30T10:01:05Z'),
    )

    expect(view.short).toBe('作成中 1:00')
    expect(view.long).toBe('作成中です（経過 1:00）。')
  })

  it('作り直しの 2 回目以降は、何回目かを添える', () => {
    expect(
      describeActiveGeneration(running({ attempt: 2 }), at('2026-09-30T10:01:05Z')).long,
    ).toContain('2 回目')
  })
})

/**
 * 送ったが、生成先がまだ作り始めていない（制作者 2026-10-04「まとめて動画生成依頼出したら、なんかカット２，３が作成中になってる
 * けど、シングルタスクじゃなかったっけ？」）。vpipe は 1 本ずつ作るので、送った 2 本目は向こうで順番を待っている。
 */
describe('describeActiveGeneration: 生成先での順番待ち', () => {
  it('生成先がまだ作り始めていなければ「生成先で順番待ち」と言う（作成中と言わない）', () => {
    const view = describeActiveGeneration(running({ providerStartedAt: null }), at('2026-09-30T10:02:36Z'))

    expect(view.short).toBe('生成先で順番待ち 2:31')
    expect(view.long).toBe(
      'MiniMax H3 Turbo 下書き（ローカル・無料）に送り、順番を待っています（2:31）。前の 1 本が終わると作り始めます。',
    )
    expect(view.overdue).toBe(false)
  })

  it('経過は作り始めてから数える（待っていた時間で「目安を大きく過ぎた」と言わない）', () => {
    // 送ってから 10 分 26 秒、作り始めてから 2 分 31 秒。目安 4 分の 2 倍は超えていない。
    const view = describeActiveGeneration(
      running({ providerStartedAt: '2026-09-30T10:08:00.000Z' }),
      at('2026-09-30T10:10:31Z'),
    )

    expect(view.short).toBe('作成中 2:31 / 約 4 分')
    expect(view.overdue).toBe(false)
  })
})
