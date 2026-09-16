import { ShotStatus, ReviewStatus, HumanVerdict } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import {
  formatSeconds,
  formatUsd,
  humanVerdictLabel,
  isGeneratingStatus,
  reviewStatusClassName,
  reviewStatusLabel,
  shotStatusClassName,
  shotStatusLabel,
} from '@/lib/shot-display'

describe('shotStatusClassName', () => {
  it('すべての状態に色とラベルがある', () => {
    for (const status of ShotStatus.options) {
      expect(shotStatusClassName(status)).not.toBe('')
      expect(shotStatusLabel(status)).not.toBe('')
    }
  })

  it('状態ごとに異なる色を返す', () => {
    const classes = ShotStatus.options.map(shotStatusClassName)
    expect(new Set(classes).size).toBe(ShotStatus.options.length)
  })

  it('生成中と承認済みは別の色', () => {
    expect(shotStatusClassName('generating')).not.toBe(shotStatusClassName('approved'))
  })
})

describe('reviewStatus / humanVerdict', () => {
  it('すべてのレビュー状態にラベルと色がある', () => {
    for (const status of ReviewStatus.options) {
      expect(reviewStatusLabel(status)).not.toBe('')
      expect(reviewStatusClassName(status)).not.toBe('')
    }
  })

  it('すべての人手判定にラベルがある', () => {
    for (const verdict of HumanVerdict.options) {
      expect(humanVerdictLabel(verdict)).not.toBe('')
    }
  })
})

describe('isGeneratingStatus', () => {
  it('generating のときだけ真', () => {
    expect(isGeneratingStatus('generating')).toBe(true)
    expect(ShotStatus.options.filter(isGeneratingStatus)).toEqual(['generating'])
  })
})

describe('数値の書式', () => {
  it('秒は小数第 2 位まで出す', () => {
    expect(formatSeconds(4)).toBe('4.00s')
    expect(formatSeconds(0.125)).toBe('0.13s')
  })

  it('コストは 3 桁で出す', () => {
    expect(formatUsd(0.35)).toBe('$0.350')
  })
})
