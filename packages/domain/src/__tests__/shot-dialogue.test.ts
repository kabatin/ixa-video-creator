import { describe, expect, it } from 'vitest'
import { CharacterId } from '../common/ids.js'
import {
  DIALOGUE_WARNING_LINES,
  DialogueLine,
  DialogueLines,
  MAX_DIALOGUE_LINES,
  MAX_DIALOGUE_TEXT_LENGTH,
  dialogueWarnings,
  formatDialogueForReview,
} from '../shot/dialogue.js'
import { UpdateShotPatch } from '../shot/shot.js'

const CAT = CharacterId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB1')
const MOUSE = CharacterId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB2')

const line = (text: string, speakerId = CAT) => ({ speakerId, text, offscreen: false, translation: null })

describe('DialogueLine', () => {
  it('話し手・セリフ・画面外の印・訳文を持つ（印と訳文は省ける）', () => {
    expect(DialogueLine.parse({ speakerId: CAT, text: 'ねえ、ネズミくん。' })).toEqual({
      speakerId: CAT, text: 'ねえ、ネズミくん。', offscreen: false, translation: null,
    })
  })

  it('話し手が無い行を拒む', () => {
    expect(DialogueLine.safeParse({ text: 'ねえ' }).success).toBe(false)
    expect(DialogueLine.safeParse({ speakerId: 'cat', text: 'ねえ' }).success).toBe(false)
  })

  it('空のセリフ・空白だけのセリフを拒む', () => {
    expect(DialogueLine.safeParse(line('')).success).toBe(false)
    expect(DialogueLine.safeParse(line('   ')).success).toBe(false)
  })

  it(`セリフは ${String(MAX_DIALOGUE_TEXT_LENGTH)} 文字まで`, () => {
    expect(DialogueLine.safeParse(line('あ'.repeat(MAX_DIALOGUE_TEXT_LENGTH))).success).toBe(true)
    expect(DialogueLine.safeParse(line('あ'.repeat(MAX_DIALOGUE_TEXT_LENGTH + 1))).success).toBe(false)
  })

  it('知らない欄を拒む（書き間違いを黙って捨てない）', () => {
    expect(DialogueLine.safeParse({ ...line('ねえ'), speaker: 'cat' }).success).toBe(false)
  })
})

describe('DialogueLines', () => {
  it(`1 Shot ${String(MAX_DIALOGUE_LINES)} 行まで`, () => {
    const lines = Array.from({ length: MAX_DIALOGUE_LINES }, (_, i) => line(`セリフ${String(i)}`))
    expect(DialogueLines.safeParse(lines).success).toBe(true)
    expect(DialogueLines.safeParse([...lines, line('多すぎ')]).success).toBe(false)
  })

  it('Shot の PATCH で行の配列を受け、行の上限を超えるものを拒む', () => {
    expect(UpdateShotPatch.safeParse({ dialogue: [line('ねえ')] }).success).toBe(true)
    const tooMany = Array.from({ length: MAX_DIALOGUE_LINES + 1 }, () => line('あ'))
    expect(UpdateShotPatch.safeParse({ dialogue: tooMany }).success).toBe(false)
    // 以前の形（文字列）はもう受けない
    expect(UpdateShotPatch.safeParse({ dialogue: 'ねえ' }).success).toBe(false)
  })
})

describe('dialogueWarnings', () => {
  it(`${String(DIALOGUE_WARNING_LINES - 1)} 行までは何も言わない`, () => {
    expect(dialogueWarnings(Array.from({ length: DIALOGUE_WARNING_LINES - 1 }, () => line('あ')))).toEqual([])
    expect(dialogueWarnings([])).toEqual([])
  })

  it(`${String(DIALOGUE_WARNING_LINES)} 行以上で長すぎると警告する（止めはしない）`, () => {
    const warnings = dialogueWarnings(Array.from({ length: DIALOGUE_WARNING_LINES }, () => line('あ')))
    expect(warnings).toEqual([{ code: 'too_many_lines', message: '長すぎます（10 秒に 3〜4 行まで）' }])
  })
})

describe('formatDialogueForReview', () => {
  it('「話し手: セリフ」の行にする。画面外の声は印を付ける', () => {
    const names = new Map([[CAT, 'ネコ'], [MOUSE, 'ネズミ']])
    expect(
      formatDialogueForReview(
        [line('ねえ、ネズミくん。'), { ...line('なに？', MOUSE), offscreen: true }],
        (id) => names.get(id) ?? null,
      ),
    ).toBe('ネコ: ねえ、ネズミくん。\nネズミ（画面外）: なに？')
  })

  it('話し手の名前が分からなければ「話し手不明」にする', () => {
    expect(formatDialogueForReview([line('ねえ')], () => null)).toBe('話し手不明: ねえ')
  })

  it('行が無ければ null', () => {
    expect(formatDialogueForReview([], () => null)).toBeNull()
  })
})
