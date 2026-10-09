import type { Take } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { formatSeconds, formatUsd } from '@/lib/shot-display'
import type { MediaInfo } from '@/lib/take-display'
import {
  takeBytesLabel,
  takeCostLabel,
  takeModelLabel,
  takeResolutionLabel,
  takeTimeLabel,
} from '@/lib/take-display'

/**
 * Take がどこから来たか（ADR-0026）。持ち込んだ Take はアプリの外で作ったので、
 * モデル名・費用・生成時間を生成した Take と同じ言葉で出すと嘘になる。
 */

type Shown = Pick<Take, 'modelId' | 'providerParams' | 'costUsd' | 'generationTimeSec' | 'copiedFromTakeId'>

const generated: Shown = {
  modelId: 'local/still-motion' as Take['modelId'],
  providerParams: { kind: 'http', request: {} },
  costUsd: 0.4,
  generationTimeSec: 12,
  copiedFromTakeId: null,
}
const imported = (sourceModel: string | null): Shown => ({
  modelId: 'import/footage' as Take['modelId'],
  providerParams: { kind: 'import', sourceModel, fileName: '01.mp4' },
  costUsd: 0,
  generationTimeSec: 0,
  copiedFromTakeId: null,
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

/** 作品の複製で写した Take（制作者 2026-10-04）。払ったのは元の作品なので、そう言う。 */
describe('takeCostLabel: 複製した Take', () => {
  it('元の作品で払った額だと言う', () => {
    const copied = { ...generated, copiedFromTakeId: '01ARZ3NDEKTSV4RRFFQ69G5FC1' as Take['copiedFromTakeId'] }

    expect(takeCostLabel(copied)).toBe(`元の作品で ${formatUsd(0.4)}`)
  })
})

/**
 * 大きさと容量（制作者 2026-10-09「Take 比較の情報に解像度とか容量も欲しい」）。
 *
 * **「まだ引けていない」と「測れていない」を混ぜない。** 混ぜると、計測に失敗した素材が
 * 読み込み中に見え、いつまでも待たれる（ADR-0044 で実際に起きた取りこぼし）。
 */
describe('Take の大きさと容量', () => {
  const info = (overrides: Partial<MediaInfo>): MediaInfo => ({
    bytes: 2_097_152,
    probe: { width: 1920, height: 1080 },
    ...overrides,
  })

  it('測れていれば大きさを出す', () => {
    expect(takeResolutionLabel(info({}))).toBe('1920×1080')
  })

  it('まだ引けていなければ「…」', () => {
    expect(takeResolutionLabel(undefined)).toBe('…')
    expect(takeBytesLabel(undefined)).toBe('…')
  })

  it('probe が無ければ「計測中」（「…」と区別する）', () => {
    expect(takeResolutionLabel(info({ probe: null }))).toBe('計測中')
  })

  it('片側だけ欠けていても「計測中」', () => {
    expect(takeResolutionLabel(info({ probe: { width: 1920, height: null } }))).toBe('計測中')
    expect(takeResolutionLabel(info({ probe: { width: null, height: 1080 } }))).toBe('計測中')
  })

  it('容量は読める単位で出す', () => {
    expect(takeBytesLabel(info({ bytes: 2_097_152 }))).toBe('2.0 MB')
  })
})
