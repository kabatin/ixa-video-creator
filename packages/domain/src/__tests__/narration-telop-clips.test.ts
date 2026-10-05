import { describe, expect, it } from 'vitest'
import { NarrationLineId, ProjectId, TextStyleId, newId } from '../common/ids.js'
import {
  DEFAULT_NARRATION_TEXT_STYLE,
  NARRATION_TELOP_LAYER,
  narrationTelopClips,
  type NarrationTelopLine,
} from '../narration/narration-telop-clips.js'
import { MIN_TEXT_CLIP_DURATION_SEC, narrationLineOf, parseTextClipParams } from '../timeline/text-template.js'

/**
 * ナレーションのテロップ（ADR-0038）。行の表示を句読点で分け、声の長さ（字の時刻があればそれ）で時刻を付けて、
 * タイムラインのテロップにする。**テロップは導かれるもの**（字を直すのは行の表示で）。
 */

const PROJECT = newId(ProjectId)
const style = { style: DEFAULT_NARRATION_TEXT_STYLE, styleId: null }

const aLine = (patch: Partial<NarrationTelopLine['line']> = {}, take: NarrationTelopLine['take'] = { inSec: 0, outSec: 2.4, charTimes: null }): NarrationTelopLine => ({
  line: { id: newId(NarrationLineId), text: 'あいうえ。かきくけ。', reading: null, startSec: 10, telop: true, ...patch },
  take,
  style,
})

const clipsOf = (lines: readonly NarrationTelopLine[], highlight = { enabled: false, color: '#ffd400' }) =>
  narrationTelopClips({ projectId: PROJECT, lines, dictionary: [], highlight })

describe('narrationTelopClips', () => {
  it('置いて声を選んだ行を、句点で分けたテロップにする（行の位置 + 声の長さで時刻。最後の枚は少し残す）', () => {
    const clips = clipsOf([aLine()])

    expect(clips.map((clip) => [clip.track, clip.layer, clip.startSec, Math.round(clip.durationSec * 1000) / 1000])).toEqual([
      ['TEXT', NARRATION_TELOP_LAYER, 10, 1.2],
      ['TEXT', NARRATION_TELOP_LAYER, 11.2, 1.5],
    ])
    expect(clips.map((clip) => parseTextClipParams(clip.content.type === 'text' ? clip.content.params : null)?.text)).toEqual([
      'あいうえ。',
      'かきくけ。',
    ])
  })

  it('どの行から作ったかの印と、見た目を付ける（保存した見た目なら、その ID も）', () => {
    const styleId = newId(TextStyleId)
    const line = { ...aLine(), style: { style: { anchor: 'top-center' as const }, styleId } }
    const [clip] = clipsOf([line])
    const params = clip?.content.type === 'text' ? clip.content.params : null

    expect(narrationLineOf(params)).toBe(line.line.id)
    expect(params).toMatchObject({ style: { anchor: 'top-center' }, styleId })
  })

  it('置いていない・声が無い・テロップを外した行には作らない', () => {
    expect(clipsOf([aLine({ startSec: null }), aLine({}, null), aLine({ telop: false })])).toEqual([])
  })

  it('話している字を強調するなら、字の時刻（その枚の頭からの秒）と色を付ける。字の時刻が無い声には付けない', () => {
    const text = 'あい。うえ。'
    const charTimes = [...text].map((char, i) => ({ char, startSec: i * 0.2, endSec: (i + 1) * 0.2 }))
    const [first, second] = clipsOf([aLine({ text }, { inSec: 0, outSec: 1.2, charTimes })], { enabled: true, color: '#ff0000' })
    const params = second?.content.type === 'text' ? second.content.params : null

    expect(params).toMatchObject({ highlight: { color: '#ff0000' } })
    expect((params as { highlight: { chars: { char: string; startSec: number }[] } }).highlight.chars.map((c) => [c.char, Math.round(c.startSec * 10) / 10])).toEqual([
      ['う', 0],
      ['え', 0.2],
      ['。', 0.4],
    ])
    expect(first?.content.type === 'text' ? first.content.params : null).toHaveProperty('highlight')
    const [plain] = clipsOf([aLine({ text })], { enabled: true, color: '#ff0000' })
    expect(plain?.content.type === 'text' ? plain.content.params : null).not.toHaveProperty('highlight')
  })

  it('声を作った後に表示を直していて、字の時刻と字数が合わなければ、時刻は使わず按分する', () => {
    const charTimes = [...'あいう'].map((char, i) => ({ char, startSec: i * 0.2, endSec: (i + 1) * 0.2 }))
    const clips = clipsOf([aLine({ text: 'あいうえお' }, { inSec: 0, outSec: 1, charTimes })], { enabled: true, color: '#ff0000' })
    expect(clips).toHaveLength(1)
    expect(clips[0]?.content.type === 'text' ? clips[0].content.params : null).not.toHaveProperty('highlight')
  })

  it(`短すぎる声でも、テロップは ${MIN_TEXT_CLIP_DURATION_SEC} 秒より短くしない`, () => {
    const [clip] = clipsOf([aLine({ text: 'あ' }, { inSec: 0, outSec: 0.1, charTimes: null })])
    expect(clip?.durationSec).toBeGreaterThanOrEqual(MIN_TEXT_CLIP_DURATION_SEC)
  })
})
