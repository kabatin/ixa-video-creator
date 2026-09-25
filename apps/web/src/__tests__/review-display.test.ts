import { type ReviewFinding, ReviewerType, Severity, Verdict } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import {
  findingSeverityClassName,
  findingSeverityLabel,
  formatEvidenceMoment,
  isReviewRunPending,
  latestReviewRun,
  reviewRunStatusLabel,
  reviewVerdictClassName,
  reviewVerdictLabel,
  reviewerLabel,
  sortFindings,
  summarizeFindings,
  summarizeRun,
} from '@/lib/review-display'

type TestFinding = Pick<ReviewFinding, 'severity' | 'evidence'> & { readonly id: string }

const finding = (
  id: string,
  severity: Severity,
  frameSec: number | null = null,
): TestFinding => ({
  id,
  severity,
  evidence: frameSec === null ? null : { frameSec, bbox: null, comparedAssetId: null },
})

const runAt = (iso: string, id: string) => ({ id, createdAt: new Date(iso) })

describe('severity の表示', () => {
  it('すべての severity にラベルと色がある', () => {
    for (const severity of Severity.options) {
      expect(findingSeverityLabel(severity)).not.toBe('')
      expect(findingSeverityClassName(severity)).not.toBe('')
    }
  })

  it('severity ごとに異なる色を返す', () => {
    const classes = Severity.options.map(findingSeverityClassName)
    expect(new Set(classes).size).toBe(Severity.options.length)
  })

  it('色は意味と一致する。fail を ok の色にしない', () => {
    expect(findingSeverityClassName('fail')).toContain('text-danger')
    expect(findingSeverityClassName('fail')).not.toContain('text-ok')
    expect(findingSeverityClassName('fail')).not.toContain('bg-ok')
    expect(findingSeverityClassName('warn')).toContain('text-warn')
  })
})

describe('verdict の表示', () => {
  it('すべての verdict にラベルと色がある', () => {
    for (const verdict of Verdict.options) {
      expect(reviewVerdictLabel(verdict)).not.toBe('')
      expect(reviewVerdictClassName(verdict)).not.toBe('')
    }
  })

  it('判定前（null）を合格と混同させない', () => {
    expect(reviewVerdictLabel(null)).toBe('判定待ち')
    expect(reviewVerdictLabel(null)).not.toBe(reviewVerdictLabel('pass'))
    expect(reviewVerdictClassName(null)).not.toContain('-ok')
  })

  it('合格だけが ok の色、不合格は danger の色', () => {
    expect(reviewVerdictClassName('pass')).toContain('text-ok')
    expect(reviewVerdictClassName('fail')).toContain('text-danger')
    expect(reviewVerdictClassName('fail')).not.toContain('text-ok')
  })
})

describe('実行状態', () => {
  it('すべての状態にラベルがある', () => {
    for (const status of ['queued', 'running', 'done', 'failed'] as const) {
      expect(reviewRunStatusLabel(status)).not.toBe('')
    }
  })

  it('queued と running のときだけ「まだ動く」', () => {
    expect(isReviewRunPending('queued')).toBe(true)
    expect(isReviewRunPending('running')).toBe(true)
    expect(isReviewRunPending('done')).toBe(false)
    expect(isReviewRunPending('failed')).toBe(false)
  })
})

describe('レビュア名と人手判断のラベル', () => {
  it('すべてのレビュアに日本語ラベルがある', () => {
    for (const reviewer of ReviewerType.options) {
      expect(reviewerLabel(reviewer)).not.toBe('')
    }
  })
})

describe('latestReviewRun', () => {
  it('空なら null', () => {
    expect(latestReviewRun([])).toBeNull()
  })

  it('API の並び順に関わらず createdAt が最新のものを返す', () => {
    const old = runAt('2026-09-16T01:00:00.000Z', 'old')
    const newest = runAt('2026-09-16T03:00:00.000Z', 'new')
    const middle = runAt('2026-09-16T02:00:00.000Z', 'mid')

    expect(latestReviewRun([newest, middle, old])?.id).toBe('new')
    expect(latestReviewRun([old, middle, newest])?.id).toBe('new')
  })

  it('同時刻なら配列の後ろを新しいとみなす', () => {
    const first = runAt('2026-09-16T01:00:00.000Z', 'first')
    const second = runAt('2026-09-16T01:00:00.000Z', 'second')

    expect(latestReviewRun([first, second])?.id).toBe('second')
  })
})

describe('sortFindings', () => {
  it('fail → warn → info の順に並べる', () => {
    const sorted = sortFindings([finding('a', 'info'), finding('b', 'fail'), finding('c', 'warn')])

    expect(sorted.map((f) => f.id)).toEqual(['b', 'c', 'a'])
  })

  it('同じ severity なら指摘された秒の早い順', () => {
    const sorted = sortFindings([finding('late', 'fail', 9), finding('early', 'fail', 1.5)])

    expect(sorted.map((f) => f.id)).toEqual(['early', 'late'])
  })

  it('秒の分からない指摘は同じ severity の最後に置く', () => {
    const sorted = sortFindings([finding('nowhere', 'warn'), finding('somewhere', 'warn', 4)])

    expect(sorted.map((f) => f.id)).toEqual(['somewhere', 'nowhere'])
  })

  it('元の配列を変更しない', () => {
    const input = [finding('a', 'info'), finding('b', 'fail')]
    const before = input.map((f) => f.id)

    sortFindings(input)

    expect(input.map((f) => f.id)).toEqual(before)
  })
})

describe('summarizeFindings', () => {
  it('severity ごとに数える', () => {
    const counts = summarizeFindings([
      finding('a', 'fail'),
      finding('b', 'fail'),
      finding('c', 'warn'),
      finding('d', 'info'),
    ])

    expect(counts).toEqual({ fail: 2, warn: 1, info: 1, total: 4 })
  })

  it('指摘が無ければすべて 0', () => {
    expect(summarizeFindings([])).toEqual({ fail: 0, warn: 0, info: 0, total: 0 })
  })
})

describe('formatEvidenceMoment', () => {
  it('秒が分かれば「何秒地点か」を返す', () => {
    expect(formatEvidenceMoment({ frameSec: 3.2, bbox: null, comparedAssetId: null })).toBe(
      '3.20s 地点',
    )
  })

  it('0 秒地点も落とさない', () => {
    expect(formatEvidenceMoment({ frameSec: 0, bbox: null, comparedAssetId: null })).toBe(
      '0.00s 地点',
    )
  })

  it('証拠が無ければ null', () => {
    expect(formatEvidenceMoment(null)).toBeNull()
    expect(formatEvidenceMoment({ frameSec: null, bbox: null, comparedAssetId: null })).toBeNull()
  })
})

describe('summarizeRun', () => {
  const counts = summarizeFindings([finding('a', 'fail'), finding('b', 'warn')])

  it('実行中は結果ではなく状態を伝える', () => {
    expect(summarizeRun({ status: 'running', verdict: null }, counts)).toBe('実行中です')
    expect(summarizeRun({ status: 'queued', verdict: null }, counts)).toBe('待機中です')
  })

  it('実行に失敗したことを合格と混同させない', () => {
    expect(summarizeRun({ status: 'failed', verdict: null }, counts)).toBe(
      'レビューの実行に失敗しました',
    )
  })

  it('指摘が無いことを明示する', () => {
    expect(summarizeRun({ status: 'done', verdict: 'pass' }, summarizeFindings([]))).toBe(
      '合格（指摘なし）',
    )
  })

  it('指摘があれば severity ごとの件数を出す', () => {
    expect(summarizeRun({ status: 'done', verdict: 'fail' }, counts)).toBe(
      '不合格（不合格 1 / 警告 1 / 情報 0）',
    )
  })
})
