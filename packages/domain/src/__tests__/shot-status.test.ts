import { describe, expect, it } from 'vitest'
import { settledShotStatus, shotStatusAfterCancel } from '../shot/status.js'

/**
 * 生成や採用が落ち着いたあとの Shot の状態（ADR-0023）。
 *
 * **採用が決定。** 採用している Take があれば、あとから生成が成功しても失敗しても
 * `approved`（採用済み）のまま。以前は worker が成功のたびに `review` へ、失敗のたびに
 * `review` へ戻していたので、採用済みの Shot で作り直しを試すだけで「採用待ち」に落ちた。
 */
describe('settledShotStatus', () => {
  it('採用している Take があれば採用済み', () => {
    expect(settledShotStatus({ hasSelectedTake: true, hasTakes: true })).toBe('approved')
  })

  it('Take はあるが採用していなければ採用待ち', () => {
    expect(settledShotStatus({ hasSelectedTake: false, hasTakes: true })).toBe('review')
  })

  it('Take が 1 本も無ければ要判断（失敗の痕跡を残す）', () => {
    expect(settledShotStatus({ hasSelectedTake: false, hasTakes: false })).toBe('blocked')
  })
})

/** 制作者 2026-10-01「動画生成をキャンセル出来るようにしたい」。やめたのは失敗ではない。 */
describe('shotStatusAfterCancel', () => {
  it('Take が 1 本も無ければ下書きに戻す（要判断にしない）', () => {
    expect(shotStatusAfterCancel({ hasSelectedTake: false, hasTakes: false })).toBe('draft')
  })

  it('Take があれば、生成が落ち着いたときと同じ', () => {
    expect(shotStatusAfterCancel({ hasSelectedTake: false, hasTakes: true })).toBe('review')
    expect(shotStatusAfterCancel({ hasSelectedTake: true, hasTakes: true })).toBe('approved')
  })
})
