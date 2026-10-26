import { describe, expect, it } from 'vitest'
import { infraDownDecision } from '../commands/infra.js'

describe('infraDownDecision（infra down で止めてよいか）', () => {
  it('この clone のコンテナなら止める（ボリュームは消さない）。無ければ済み', () => {
    expect(infraDownDecision({ kind: 'mine' })).toBe('down')
    expect(infraDownDecision({ kind: 'none' })).toBe('already')
  })

  it('別の clone のコンテナは、共有の設定でも止めない（その clone で止める）', () => {
    expect(infraDownDecision({ kind: 'other', dir: '/Users/me/ixa-video-creator' })).toBe('refuse')
  })
})
