import { CharacterId, TakeId, newId, type DubParams } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { draftsFrom, savableLines } from '@/lib/dialogue-lines'
import {
  DUB_LEVEL_RANGE_MESSAGE,
  dubFieldText,
  dubResultRows,
  editDubField,
  editDubFlag,
  parseDubLevelInput,
  withSuggestedSpan,
} from '@/lib/dub-view'

/** 声の差し替え（ADR-0062）の画面の言葉と、行ごとの「差し替えの指定」の欄の読み書き。 */

const record = (lines: DubParams['lines']): DubParams => ({
  kind: 'dub',
  sourceTakeId: newId(TakeId),
  voiceTool: 'gemini_api',
  model: 'gemini-3.8-flash-tts',
  integratedLufs: -16,
  lines,
})

const line = (lineIndex: number, patch: Partial<DubParams['lines'][number]> = {}): DubParams['lines'][number] => ({
  lineIndex,
  mode: 'lip',
  added: false,
  sourceStartSec: 0.5,
  sourceEndSec: 1.5,
  placedStartSec: 0.46,
  placedEndSec: 1.6,
  agreement: 0.923,
  tempoMin: 1.05,
  tempoMax: 1.32,
  reading: 'plain',
  warnings: [],
  ...patch,
})

describe('dubResultRows', () => {
  it('一致率は %、伸縮の幅は「最小〜最大 倍」。1.4 倍を超えた行は早口として黄色にする', () => {
    const rows = dubResultRows(
      record([
        line(1, { tempoMax: 1.45, warnings: [{ code: 'fast_tempo', message: '早口に聞こえます。読み方の指示か Shot の指示を直してください' }] }),
        line(0),
        line(2, { mode: 'keep_original', agreement: null, tempoMin: 1, tempoMax: 1, reading: null }),
      ]),
      [{ text: 'ねえ' }, { text: 'なに？' }, { text: 'ふふ' }],
    )
    expect(rows.map((row) => [row.lineNo, row.agreement, row.tempo, row.fast])).toEqual([
      [1, '92%', '1.05〜1.32 倍', false],
      [2, '92%', '1.05〜1.45 倍', true],
      [3, '—', '1.00 倍', false],
    ])
    expect(rows[1]?.warnings).toEqual(['早口に聞こえます。読み方の指示か Shot の指示を直してください'])
    expect(rows[2]?.mode).toBe('元の声のまま')
  })
})

describe('差し替えの指定の欄', () => {
  it('時刻は 0:01.20、長さは 1.20s で読み書きする', () => {
    const placed = editDubField(undefined, 'placeAtSec', '0:01.20')
    expect(placed).toEqual({ ok: true, dub: { placeAtSec: 1.2 } })
    if (!placed.ok) return
    expect(dubFieldText(placed.dub, 'placeAtSec')).toBe('0:01.20')
    const fit = editDubField(placed.dub, 'fitSec', '1.5s')
    expect(fit).toEqual({ ok: true, dub: { placeAtSec: 1.2, fitSec: 1.5 } })
  })

  it('空にした欄は指定なし。全部なくなれば行に dub を持たせない', () => {
    expect(editDubField({ levelDb: -6.5 }, 'levelDb', '')).toEqual({ ok: true, dub: undefined })
  })

  it('範囲の外・読めない値・食い違いは保存せず、日本語の理由を返す', () => {
    expect(editDubField(undefined, 'levelDb', '13')).toEqual({ ok: false, message: DUB_LEVEL_RANGE_MESSAGE })
    expect(editDubField(undefined, 'levelDb', '-40.5')).toEqual({ ok: false, message: DUB_LEVEL_RANGE_MESSAGE })
    expect(editDubField(undefined, 'placeAtSec', 'あとで')).toEqual({ ok: false, message: '置く時刻: 0:01.20 のように入れてください' })
    expect(editDubField(undefined, 'fitSec', '0.05')).toEqual({ ok: false, message: '収める長さは 0.10s 以上・2:00 までにしてください' })
    expect(editDubField({ fitSec: 1 }, 'cutSec', '0.8')).toEqual({
      ok: false,
      message: '収める長さと切る長さは、どちらか 1 つだけにしてください',
    })
  })

  it('足す行をやめると、音量を合わせる行も外す。snap: false は残す', () => {
    expect(editDubFlag({ added: true, placeAtSec: 2, levelLikeIndex: 0, snap: false }, { added: false })).toEqual({
      ok: true,
      dub: { placeAtSec: 2, snap: false },
    })
    expect(editDubFlag(undefined, { added: true })).toEqual({ ok: false, message: '足す行には、置く時刻が要ります' })
  })

  it('行の区間の案を入れる', () => {
    expect(withSuggestedSpan({ style: '小声で' }, { startSec: 0.2, endSec: 0.65 })).toEqual({
      ok: true,
      dub: { style: '小声で', startSec: 0.2, endSec: 0.65 },
    })
  })

  it('距離の既定は -40〜12 dB。空は 0', () => {
    expect(parseDubLevelInput('-9.5')).toBe(-9.5)
    expect(parseDubLevelInput('')).toBe(0)
    expect(parseDubLevelInput('12.5')).toBeNull()
    expect(parseDubLevelInput('奥')).toBeNull()
  })
})

describe('セリフの下書きと差し替えの指定', () => {
  it('指定のある行はそのまま保存し、無い行には dub の鍵を持たせない', () => {
    const speakerId = newId(CharacterId)
    const lines = [
      { speakerId, text: 'ねえ', offscreen: false, translation: null, dub: { levelDb: -9.5 } },
      { speakerId, text: 'なに', offscreen: false, translation: null },
    ]
    const saved = savableLines(draftsFrom(lines))
    expect(saved).toEqual(lines)
    expect('dub' in (saved[1] ?? {})).toBe(false)
  })
})
