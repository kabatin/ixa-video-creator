import { describe, expect, it } from 'vitest'
import { narrationDuring } from '../narration/narration-line.js'

/** その区間（Shot）の間に話し始めるナレーション（ADR-0038）。絵コンテの案に「この Shot で話される言葉」として渡す。 */

describe('narrationDuring', () => {
  const lines = [
    { text: '二行目', startSec: 3.5 },
    { text: '一行目', startSec: 0.5 },
    { text: '置いていない', startSec: null },
    { text: '三行目', startSec: 6 },
  ]

  it('区間の頭以上・終わり未満で話し始める行を、位置の順に返す（置いていない行は入れない）', () => {
    expect(narrationDuring(lines, { startSec: 0, durationSec: 6 })).toEqual(['一行目', '二行目'])
    expect(narrationDuring(lines, { startSec: 6, durationSec: 2 })).toEqual(['三行目'])
    expect(narrationDuring(lines, { startSec: 8, durationSec: 2 })).toEqual([])
  })
})
