import { ShotStatus, ReviewStatus, HumanVerdict, SourceTypeName } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import {
  formatSeconds,
  formatTimecode,
  formatUsd,
  humanVerdictLabel,
  isGeneratingStatus,
  reviewStatusClassName,
  reviewStatusLabel,
  shotStatusClassName,
  shotStatusLabel,
  sourceTypeLabel,
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

describe('sourceTypeLabel', () => {
  it('すべての生成方式に日本語ラベルがある', () => {
    for (const name of SourceTypeName.options) {
      expect(sourceTypeLabel(name)).not.toBe('')
    }
  })

  it('生の enum をそのまま返さない', () => {
    for (const name of SourceTypeName.options) {
      expect(sourceTypeLabel(name)).not.toBe(name)
    }
  })

  it('生成方式ごとに違うラベルを返す', () => {
    const labels = SourceTypeName.options.map(sourceTypeLabel)
    expect(new Set(labels).size).toBe(SourceTypeName.options.length)
  })
})

describe('formatTimecode', () => {
  it('位置は時計形式、尺は秒で出す（format-time に揃える）', () => {
    expect(formatTimecode({ startSec: 3.75, durationSec: 3.75 })).toBe('0:03.75 – 0:07.50（3.75s）')
  })

  it('1 分を越えても分に繰り上がる', () => {
    expect(formatTimecode({ startSec: 62.5, durationSec: 2 })).toBe('1:02.50 – 1:04.50（2.00s）')
  })
})
