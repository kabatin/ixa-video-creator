import type { Shot, ShotId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import {
  deleteMenuLabel,
  describeDeleteTargets,
  resolveDeleteTargets,
  summarizeDeleteResults,
} from '@/lib/delete-shots'

/**
 * Shot の削除（制作者の要望 2026-09-26）。
 *
 * 以前はメニュー「Shot」→「選択を削除」しかなく、消えるのは**いま選んでいる 1 件**だった。
 * 「選択」がチェックした Shot のことにも読め、チェックして押すと別の 1 件が消えうる。
 * **チェックがあればチェックした Shot、無ければ選んでいる Shot**を対象にし、何を消すかを
 * 項目名と確認の文で言う。
 */

const shot = (code: string, startSec: number): Shot =>
  ({ id: `id-${code}` as ShotId, code, startSec, durationSec: 2 }) as unknown as Shot

const SHOTS = [shot('CUT-01', 0), shot('CUT-02', 2), shot('CUT-03', 4)]
const ids = (...codes: string[]): ReadonlySet<ShotId> => new Set(codes.map((c) => `id-${c}` as ShotId))

describe('resolveDeleteTargets', () => {
  it('チェックがあれば、選んでいる Shot ではなくチェックした Shot を対象にする', () => {
    const targets = resolveDeleteTargets(SHOTS, ids('CUT-03', 'CUT-01'), 'id-CUT-02' as ShotId)

    // 並びは一覧の順。チェックした順ではない。
    expect(targets.map((s) => s.code)).toEqual(['CUT-01', 'CUT-03'])
  })

  it('チェックが無ければ、選んでいる 1 件', () => {
    expect(resolveDeleteTargets(SHOTS, new Set(), 'id-CUT-02' as ShotId).map((s) => s.code)).toEqual([
      'CUT-02',
    ])
  })

  it('どちらも無ければ空', () => {
    expect(resolveDeleteTargets(SHOTS, new Set(), null)).toEqual([])
  })
})

describe('deleteMenuLabel', () => {
  it('チェックの件数を項目名で言う', () => {
    expect(deleteMenuLabel(3)).toBe('チェックした 3 件を削除…')
  })

  it('チェックが無ければ「この Shot」', () => {
    expect(deleteMenuLabel(0)).toBe('この Shot を削除…')
  })
})

describe('describeDeleteTargets', () => {
  it('1 件なら Shot の名前と区間を言う', () => {
    expect(describeDeleteTargets([shot('CUT-02', 2)])).toContain('CUT-02')
  })

  it('複数なら件数とコードを言い、元に戻せないことを言う', () => {
    const text = describeDeleteTargets(SHOTS)

    expect(text).toContain('3 件')
    expect(text).toContain('CUT-01')
    expect(text).toContain('元に戻せません')
  })

  it('多すぎるコードは畳む（確認の文が画面を埋めない）', () => {
    const many = Array.from({ length: 12 }, (_, i) => shot(`CUT-${String(i + 1).padStart(2, '0')}`, i))
    const text = describeDeleteTargets(many)

    expect(text).toContain('ほか 7 件')
    expect(text).not.toContain('CUT-12')
  })
})

describe('summarizeDeleteResults', () => {
  it('全部消えたら件数だけ言う', () => {
    expect(
      summarizeDeleteResults(SHOTS, [
        { shotId: 'id-CUT-01', ok: true },
        { shotId: 'id-CUT-02', ok: true },
      ]),
    ).toBe('2 件の Shot を削除しました。')
  })

  it('消せなかった Shot は黙らず、コードと理由を言う', () => {
    const text = summarizeDeleteResults(SHOTS, [
      { shotId: 'id-CUT-01', ok: true },
      { shotId: 'id-CUT-03', ok: false, reason: 'Shot が見つかりません' },
    ])

    expect(text).toContain('1 件の Shot を削除しました。')
    expect(text).toContain('CUT-03')
    expect(text).toContain('Shot が見つかりません')
  })
})
