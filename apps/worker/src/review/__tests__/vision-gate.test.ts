import { describe, expect, it } from 'vitest'
import { VISION_NOT_CLAUDE_MESSAGE, VISION_OFF_MESSAGE, visionSkipReasonOf } from '../vision-gate.js'

/**
 * Take の画像を見る判定をするか（ADR-0066。制作者 2026-10-28「トークン消費激しすぎる」）。
 * Take のチェックを入れていて、テキストの AI が Claude のときだけ判定する。それ以外は判定しない（お試しで代えない）。
 */
describe('visionSkipReasonOf', () => {
  it('Take のチェックを入れていて Claude なら判定する', () => {
    expect(visionSkipReasonOf({ text: 'claude_cli', checks: { image: false, video: true } })).toBeNull()
  })

  it('Take のチェックを切っていれば、Claude を選んでいても判定しない（絵のチェックとは別）', () => {
    expect(visionSkipReasonOf({ text: 'claude_cli', checks: { image: true, video: false } })).toBe(VISION_OFF_MESSAGE)
  })

  it('入れていても、テキストの AI が Claude でなければ判定しない', () => {
    expect(visionSkipReasonOf({ text: 'codex_cli', checks: { image: false, video: true } })).toBe(VISION_NOT_CLAUDE_MESSAGE)
    expect(visionSkipReasonOf({ text: 'stub', checks: { image: false, video: true } })).toBe(VISION_NOT_CLAUDE_MESSAGE)
  })

  it('画面に出る文に実装の言葉を入れない', () => {
    for (const message of [VISION_OFF_MESSAGE, VISION_NOT_CLAUDE_MESSAGE]) {
      expect(message).not.toMatch(/vision|stub|worker|API|claude_cli/)
    }
  })
})
