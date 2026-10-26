import { CharacterId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import {
  addDraftLine,
  draftsFrom,
  moveDraftLine,
  removeDraftLine,
  savableLines,
  sameSavedLines,
  speakerChoices,
  translationFromInput,
  updateDraftLine,
  type DraftLine,
} from '@/lib/dialogue-lines'

describe('translationFromInput（訳文の欄。ADR-0061）', () => {
  it('前後の空白を落とし、空なら訳文なし（null）', () => {
    expect(translationFromInput('  Hey.  ')).toBe('Hey.')
    expect(translationFromInput('   ')).toBeNull()
    expect(translationFromInput('')).toBeNull()
  })
})

const CAT = CharacterId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB1')
const MOUSE = CharacterId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB2')
const OWL = CharacterId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB3')

const draft = (text: string, speakerId: CharacterId | null = CAT): DraftLine => ({
  speakerId, text, offscreen: false, translation: null,
})

describe('savableLines', () => {
  it('話し手とセリフのある行だけを、前後の空白を落として送る形にする', () => {
    expect(savableLines([draft('  ねえ  '), draft(''), draft('なに', null), draft('   ')])).toEqual([
      { speakerId: CAT, text: 'ねえ', offscreen: false, translation: null },
    ])
  })
})

describe('行の操作は元の配列を変えない', () => {
  const lines = [draft('一'), draft('二'), draft('三')]

  it('足すと、話し手は配役の先頭（いなければ全キャラクターの先頭）', () => {
    expect(addDraftLine(lines, MOUSE).at(-1)).toEqual(draft('', MOUSE))
    expect(addDraftLine([], null)).toEqual([draft('', null)])
    expect(lines).toHaveLength(3)
  })

  it('直す・消す・並べ替える', () => {
    expect(updateDraftLine(lines, 1, { offscreen: true })[1]?.offscreen).toBe(true)
    expect(removeDraftLine(lines, 0).map((l) => l.text)).toEqual(['二', '三'])
    expect(moveDraftLine(lines, 2, -1).map((l) => l.text)).toEqual(['一', '三', '二'])
    expect(moveDraftLine(lines, 0, -1).map((l) => l.text)).toEqual(['一', '二', '三'])
    expect(lines.map((l) => l.text)).toEqual(['一', '二', '三'])
  })
})

describe('sameSavedLines', () => {
  it('書きかけの空の行は比べない（保存した行が同じなら手元の下書きを残す）', () => {
    const saved = savableLines([draft('ねえ')])
    expect(sameSavedLines([draft('ねえ'), draft('')], saved)).toBe(true)
    expect(sameSavedLines([draft('ねえ!')], saved)).toBe(false)
  })
})

describe('draftsFrom', () => {
  it('保存済みの行を下書きにする', () => {
    expect(draftsFrom([{ speakerId: CAT, text: 'ねえ', offscreen: true, translation: null }])).toEqual([
      { speakerId: CAT, text: 'ねえ', offscreen: true, translation: null },
    ])
  })
})

describe('speakerChoices', () => {
  const all = [
    { id: CAT, displayName: 'ネコ' },
    { id: MOUSE, displayName: 'ネズミ' },
    { id: OWL, displayName: 'フクロウ' },
  ]

  it('配役の人を先に、配役にいない人（画面外の声）を後に分けて並べる', () => {
    expect(speakerChoices([MOUSE], all)).toEqual({
      cast: [{ id: MOUSE, displayName: 'ネズミ' }],
      others: [{ id: CAT, displayName: 'ネコ' }, { id: OWL, displayName: 'フクロウ' }],
    })
  })

  it('配役がいなければ、全キャラクターから選ぶ', () => {
    expect(speakerChoices([], all)).toEqual({ cast: [], others: all })
  })
})
