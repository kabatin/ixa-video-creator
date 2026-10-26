import { describe, expect, it } from 'vitest'
import { CharacterId, ProjectId, ShotId, TextStyleId, TimelineClipId, newId } from '../common/ids.js'
import {
  DIALOGUE_TELOP_LAYER,
  DEFAULT_DIALOGUE_TEXT_STYLE,
  dialogueLineSpans,
  dialogueTelopClips,
  type DialogueTelopShot,
} from '../shot/dialogue-telop-clips.js'
import type { DialogueLine } from '../shot/dialogue.js'
import { dialogueTelopOf, parseTextClipParams } from '../timeline/text-template.js'
import { TimelineClip, type CreateTimelineClipInput } from '../timeline/timeline.js'

/**
 * セリフの字幕（ADR-0061）。Shot の行ごとに 1 枚のテロップを作る。
 * 時刻は、鳴らす Take の話している区間を行の順に当て、数が合わなければ Shot の尺を行の文字数で割り振る。
 * 手で直した時刻は保つ。
 */

const PROJECT = newId(ProjectId)
const SPEAKER = newId(CharacterId)

const line = (text: string, translation: string | null = null): DialogueLine => ({ speakerId: SPEAKER, text, offscreen: false, translation })

const aShot = (patch: Partial<DialogueTelopShot['shot']> = {}, rest: Partial<Omit<DialogueTelopShot, 'shot'>> = {}): DialogueTelopShot => ({
  shot: { id: newId(ShotId), startSec: 10, durationSec: 6, sourceInSec: 0, dialogue: [line('あいう'), line('かきくけこさ')], ...patch },
  playbackRate: 1,
  speech: null,
  ...rest,
})

const spansOf = (clips: readonly CreateTimelineClipInput[]) => clips.map((clip) => [clip.startSec, clip.durationSec])
const paramsOf = (clip: CreateTimelineClipInput | TimelineClip | undefined) =>
  parseTextClipParams(clip?.content.type === 'text' ? clip.content.params : null)

/** 作ったテロップを「保存済みのクリップ」にする（次の同期の入力）。 */
const saved = (clip: CreateTimelineClipInput, patch: Partial<TimelineClip> = {}): TimelineClip =>
  TimelineClip.parse({ ...clip, id: newId(TimelineClipId), projectId: PROJECT, createdAt: new Date(0), ...patch })

describe('dialogueLineSpans（時刻の決め方）', () => {
  it('音を鳴らさない・測っていない Take は、Shot の尺を行の文字数で割り振る', () => {
    // 3 字と 6 字 → 6 秒を 2 秒と 4 秒。
    expect(dialogueLineSpans(aShot())).toEqual([
      { offsetSec: 0, durationSec: 2 },
      { offsetSec: 2, durationSec: 4 },
    ])
  })

  it('話している区間が行の数と同じなら、行の順に当てる', () => {
    const shot = aShot({}, { speech: [{ startSec: 0.5, endSec: 1.5 }, { startSec: 2.2, endSec: 4.0 }] })
    expect(dialogueLineSpans(shot)).toEqual([
      { offsetSec: 0.5, durationSec: 1 },
      { offsetSec: 2.2, durationSec: 1.8 },
    ])
  })

  it('区間は Take の時刻なので、切り出し位置と速さで Shot の時刻に直す（画面に出ない区間は数えない）', () => {
    const shot = aShot(
      { sourceInSec: 1 },
      { playbackRate: 2, speech: [{ startSec: 0.2, endSec: 0.8 }, { startSec: 2, endSec: 3 }, { startSec: 5, endSec: 7 }] },
    )
    // 0.2〜0.8 は切り出しの前で画面に出ない。残り 2 つが (2-1)/2=0.5〜1、(5-1)/2=2〜3。
    expect(dialogueLineSpans(shot)).toEqual([
      { offsetSec: 0.5, durationSec: 0.5 },
      { offsetSec: 2, durationSec: 1 },
    ])
  })

  it('区間の数が行の数と合わなければ、割り振りに戻る', () => {
    const shot = aShot({}, { speech: [{ startSec: 0.5, endSec: 4 }] })
    expect(dialogueLineSpans(shot)).toEqual(dialogueLineSpans(aShot()))
  })

  it('測ったが無音（区間 0）でも、割り振りに戻る', () => {
    expect(dialogueLineSpans(aShot({}, { speech: [] }))).toEqual(dialogueLineSpans(aShot()))
  })
})

describe('dialogueTelopClips', () => {
  it('行ごとに 1 枚。層はナレーションと同じ 2、位置は Shot の頭から', () => {
    const shot = aShot()
    const clips = dialogueTelopClips({ projectId: PROJECT, shots: [shot], existing: [] })
    expect(clips.map((clip) => [clip.track, clip.layer])).toEqual([
      ['TEXT', DIALOGUE_TELOP_LAYER],
      ['TEXT', DIALOGUE_TELOP_LAYER],
    ])
    expect(DIALOGUE_TELOP_LAYER).toBe(2)
    expect(spansOf(clips)).toEqual([
      [10, 2],
      [12, 4],
    ])
    expect(paramsOf(clips[0])?.text).toBe('あいう')
    expect(paramsOf(clips[0])?.style).toEqual(DEFAULT_DIALOGUE_TEXT_STYLE)
    expect(dialogueTelopOf(clips[1]?.content.type === 'text' ? clips[1].content.params : null)).toEqual({
      shotId: shot.shot.id,
      lineIndex: 1,
      placed: { startSec: 12, durationSec: 4 },
    })
  })

  it('訳文は行の訳文を写す。無い行は鍵を持たない', () => {
    const shot = aShot({ dialogue: [line('ねえ', 'Hey'), line('なに')] })
    const clips = dialogueTelopClips({ projectId: PROJECT, shots: [shot], existing: [] })
    expect(paramsOf(clips[0])?.translation).toBe('Hey')
    expect(paramsOf(clips[1])).not.toHaveProperty('translation')
  })

  it('セリフの無い Shot からは作らない', () => {
    expect(dialogueTelopClips({ projectId: PROJECT, shots: [aShot({ dialogue: [] })], existing: [] })).toEqual([])
  })

  it('手で直した時刻は保ち、手で直していない行だけ作り直す', () => {
    const shot = aShot()
    const first = dialogueTelopClips({ projectId: PROJECT, shots: [shot], existing: [] })
    const [a, b] = first
    if (a === undefined || b === undefined) throw new Error('2 枚あるはず')
    // 1 行目を手で 10.5〜11.5 に動かした。そのあと Take の区間が分かった。
    const existing = [saved(a, { startSec: 10.5, durationSec: 1 }), saved(b)]
    const later = aShot({ id: shot.shot.id }, { speech: [{ startSec: 0.2, endSec: 1 }, { startSec: 3, endSec: 5 }] })
    const next = dialogueTelopClips({ projectId: PROJECT, shots: [later], existing })
    expect(spansOf(next)).toEqual([
      [10.5, 1],
      [13, 2],
    ])
    // 手で直した印（置いた時刻）は最初のまま。次も手の値として扱う。
    expect(dialogueTelopOf(next[0]?.content.type === 'text' ? next[0].content.params : null)?.placed).toEqual({ startSec: 10, durationSec: 2 })
  })

  it('当てた見た目と型は引き継ぐ（同期で消さない）', () => {
    const shot = aShot({ dialogue: [line('ねえ')] })
    const [clip] = dialogueTelopClips({ projectId: PROJECT, shots: [shot], existing: [] })
    if (clip === undefined || clip.content.type !== 'text') throw new Error('1 枚あるはず')
    const styleId = newId(TextStyleId)
    const restyled = saved(clip, {
      content: { type: 'text', templateKey: 'lower_third', params: { ...clip.content.params, style: { color: '#FFD100' }, styleId } },
    })
    const [next] = dialogueTelopClips({ projectId: PROJECT, shots: [shot], existing: [restyled] })
    expect(next?.content).toMatchObject({ templateKey: 'lower_third', params: { style: { color: '#FFD100' }, styleId } })
  })

  it('短い区間は最短の尺まで延ばすが、次の行の頭と Shot の終わりは越えない（層 2 で重ねない）', () => {
    const shot = aShot(
      { durationSec: 2 },
      { speech: [{ startSec: 0.2, endSec: 0.4 }, { startSec: 0.5, endSec: 0.6 }, { startSec: 1.8, endSec: 1.9 }] },
    )
    const three = { ...shot, shot: { ...shot.shot, dialogue: [line('あ'), line('い'), line('う')] } }
    const clips = dialogueTelopClips({ projectId: PROJECT, shots: [three], existing: [] })
    // 1 行目は 0.5（次の行の頭）まで、2 行目は最短の 0.5 秒、3 行目は Shot の終わり（12）まで。
    expect(spansOf(clips)).toEqual([
      [10.2, 0.3],
      [10.5, 0.5],
      [11.8, 0.2],
    ])
  })

  it('テロップに入らない長いセリフは、入る長さで切って「…」を付ける', () => {
    const long = 'あ'.repeat(150)
    const [clip] = dialogueTelopClips({ projectId: PROJECT, shots: [aShot({ dialogue: [line(long)] })], existing: [] })
    const text = paramsOf(clip)?.text ?? ''
    expect([...text]).toHaveLength(120)
    expect(text.endsWith('…')).toBe(true)
  })
})

describe('dialogueTelopOf', () => {
  it('印の無いテロップ・読めない印は null', () => {
    expect(dialogueTelopOf({ text: '歌詞' })).toBeNull()
    expect(dialogueTelopOf({ text: '歌詞', dialogue: { shotId: 'x', lineIndex: 0 } })).toBeNull()
  })

  it('読み出し（parseTextClipParams）でも印は残る（画面が丸ごと送り返しても消えない）', () => {
    const dialogue = { shotId: newId(ShotId), lineIndex: 0, placed: { startSec: 1, durationSec: 2 } }
    expect(parseTextClipParams({ text: 'ねえ', dialogue })?.dialogue).toEqual(dialogue)
  })
})
