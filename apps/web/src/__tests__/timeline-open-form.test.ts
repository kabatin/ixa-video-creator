import { TimelineClipId, ProjectId } from '@ixa/domain'
import type { TimelineClip } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { PROJECT_ID } from '@/__tests__/fixtures'
import { textEditDraft, textInsertDraft } from '@/lib/timeline-open-form'
import type { TextInsertionProbe } from '@/lib/timeline-insert'

/**
 * 帯の上で開く入力の初期値。
 *
 * **`null`（読めなかった）と空文字（まだ無い）を取り違えないこと**を固定する。
 * 取り違えると、新規に置く場所で「保存されている文字を上書きします」と断ってしまう。
 * 実際にそうなっていた。
 */

const clipOf = (content: TimelineClip['content']): TimelineClip => ({
  id: TimelineClipId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB7'),
  projectId: ProjectId.parse(PROJECT_ID),
  track: 'TEXT',
  startSec: 1,
  durationSec: 2,
  layer: 0,
  content,
  opacity: 1,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
})

const okProbe: TextInsertionProbe = {
  ok: true,
  gap: { startSec: 5, durationSec: 10 },
  span: { startSec: 5, durationSec: 3 },
  shortened: false,
  message: '置けます',
}

describe('これから置くテロップ', () => {
  it('文字は空文字。**読めなかった印（null）ではない**', () => {
    const draft = textInsertDraft(okProbe)

    expect(draft.kind).toBe('text')
    // ここが null だと、入力欄が「元の文字を上書きします」と断る。
    expect(draft.kind === 'text' ? draft.text : undefined).toBe('')
    expect(draft.kind === 'text' ? draft.text : undefined).not.toBeNull()
  })

  it('テンプレートは選ばれた状態で始まる', () => {
    const draft = textInsertDraft(okProbe)

    expect(draft.kind === 'text' ? draft.templateKey : null).not.toBeNull()
  })

  it('置ける区間から開始と尺を取る', () => {
    const draft = textInsertDraft(okProbe)

    expect(draft.kind === 'text' ? draft.startSec : null).toBe('5.00')
    expect(draft.kind === 'text' ? draft.durationSec : null).toBe('3.00')
  })
})

describe('既にあるテロップを開く', () => {
  it('読める中身はそのまま初期値になる', () => {
    const draft = textEditDraft(
      clipOf({ type: 'text', templateKey: 'lower_third', params: { text: '開幕' } }),
    )

    expect(draft.kind === 'text' ? draft.text : null).toBe('開幕')
    expect(draft.kind === 'text' ? draft.templateKey : null).toBe('lower_third')
  })

  /**
   * 実データにある古い形。テンプレート名がハイフンで、文字は `params.label`。
   * **空文字に畳むと、送った瞬間に古い内容を黙って踏み潰す。**
   */
  it('読めない文字は null。空文字に畳まない', () => {
    const draft = textEditDraft(
      clipOf({ type: 'text', templateKey: 'lower-third', params: { label: 'iXA CUP' } }),
    )

    expect(draft.kind === 'text' ? draft.text : undefined).toBeNull()
    expect(draft.kind === 'text' ? draft.templateKey : undefined).toBeNull()
  })

  it('知らないテンプレート名は、何だったかを残す', () => {
    const draft = textEditDraft(
      clipOf({ type: 'text', templateKey: 'lower-third', params: { text: '開幕' } }),
    )

    expect(draft.kind === 'text' ? draft.rawTemplateKey : undefined).toBe('lower-third')
    // 文字は読めているので null にしない。
    expect(draft.kind === 'text' ? draft.text : undefined).toBe('開幕')
  })

  it('空文字が保存されていたら読めなかった扱いにする', () => {
    const draft = textEditDraft(
      clipOf({ type: 'text', templateKey: 'plain', params: { text: '   ' } }),
    )

    expect(draft.kind === 'text' ? draft.text : undefined).toBeNull()
  })

  it('テロップでないクリップを開いても壊れない', () => {
    const draft = textEditDraft(
      clipOf({ type: 'motion_graphics', templateKey: 'ink_splash', params: {} }),
    )

    expect(draft.kind).toBe('text')
    expect(draft.kind === 'text' ? draft.text : undefined).toBeNull()
  })

  it('開始と尺はクリップの値から入る', () => {
    const draft = textEditDraft(
      clipOf({ type: 'text', templateKey: 'plain', params: { text: 'あ' } }),
    )

    expect(draft.kind === 'text' ? draft.startSec : null).toBe('1.00')
    expect(draft.kind === 'text' ? draft.durationSec : null).toBe('2.00')
  })
})
