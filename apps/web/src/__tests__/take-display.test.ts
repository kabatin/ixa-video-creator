import type { Take } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { formatSeconds, formatUsd } from '@/lib/shot-display'
import { takeCostLabel, takeModelLabel, takeTimeLabel } from '@/lib/take-display'

/**
 * Take がどこから来たか（ADR-0026）。持ち込んだ Take はアプリの外で作ったので、
 * モデル名・費用・生成時間を生成した Take と同じ言葉で出すと嘘になる。
 */

type Shown = Pick<Take, 'modelId' | 'providerParams' | 'costUsd' | 'generationTimeSec'>

const generated: Shown = {
  modelId: 'local/still-motion' as Take['modelId'],
  providerParams: { kind: 'http', request: {} },
  costUsd: 0.4,
  generationTimeSec: 12,
}
const imported = (sourceModel: string | null): Shown => ({
  modelId: 'import/footage' as Take['modelId'],
  providerParams: { kind: 'import', sourceModel, fileName: '01.mp4' },
  costUsd: 0,
  generationTimeSec: 0,
})

describe('takeModelLabel', () => {
  it('生成した Take はモデル名', () => {
    expect(takeModelLabel(generated)).toBe('local/still-motion')
  })

  it('持ち込んだ Take は作ったモデル（分からなければそう言う）', () => {
    expect(takeModelLabel(imported('Veo 3.1 Lite（推定）'))).toBe('持ち込み: Veo 3.1 Lite（推定）')
    expect(takeModelLabel(imported(null))).toBe('持ち込み（モデル不明）')
  })
})

describe('takeCostLabel / takeTimeLabel', () => {
  it('生成した Take は額と時間（今までと同じ書式）', () => {
    expect(takeCostLabel(generated)).toBe(formatUsd(0.4))
    expect(takeTimeLabel(generated)).toBe(formatSeconds(12))
  })

  it('持ち込んだ Take は $0 や 0 秒と言わない（アプリの外で掛かった）', () => {
    expect(takeCostLabel(imported(null))).toBe('アプリの外')
    expect(takeTimeLabel(imported(null))).toBe('—')
  })
})
