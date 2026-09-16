import type { MusicSection } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { MUSIC_TRACK_ID, SEQUENCE_ID } from '@/__tests__/fixtures'
import {
  MAX_REQUESTED_COUNT,
  NO_SEQUENCE_VALUE,
  describeSection,
  initialStoryboardFormValues,
  validateStoryboardForm,
  type StoryboardFormValues,
} from '@/lib/storyboard-form'

const SECTIONS: readonly MusicSection[] = [
  { start: 0, end: 32, label: 'intro', energy: 0.3 },
  { start: 32, end: 56, label: 'chorus', energy: 0.9 },
]

const valid = (overrides: Partial<StoryboardFormValues> = {}): StoryboardFormValues => ({
  ...initialStoryboardFormValues(MUSIC_TRACK_ID),
  ...overrides,
})

const run = (overrides: Partial<StoryboardFormValues> = {}, sections = SECTIONS) =>
  validateStoryboardForm(valid(overrides), sections)

describe('validateStoryboardForm', () => {
  it('正しい入力を送信本文へ変換する', () => {
    const result = run({ sectionIndex: '1', requestedCount: '8', subdivision: '0.5' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.input.musicTrackId).toBe(MUSIC_TRACK_ID)
    expect(result.input.sectionIndex).toBe(1)
    expect(result.input.requestedCount).toBe(8)
    expect(result.input.subdivision).toBe(0.5)
    expect(result.input.sequenceId).toBeNull()
  })

  it('Sequence を選べばそのまま渡す', () => {
    const result = run({ sequenceId: SEQUENCE_ID })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.input.sequenceId).toBe(SEQUENCE_ID)
  })

  it('未選択の Sequence は null になる', () => {
    const result = run({ sequenceId: NO_SEQUENCE_VALUE })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.input.sequenceId).toBeNull()
  })

  it('楽曲が ULID でなければ弾く', () => {
    const result = run({ musicTrackId: 'not-a-ulid' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.musicTrackId).toBeDefined()
  })

  it('セクション添字が範囲外なら弾く', () => {
    const result = run({ sectionIndex: '5' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.sectionIndex).toBeDefined()
  })

  it('セクションが 1 つも無ければ弾く', () => {
    const result = run({ sectionIndex: '0' }, [])

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.sectionIndex).toBeDefined()
  })

  it.each(['0', '-1', '1.5', '', '   ', 'abc'])('カット数 %s を弾く', (requestedCount) => {
    const result = run({ requestedCount })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.requestedCount).toBeDefined()
  })

  it('桁を間違えた大きすぎるカット数を、送る前に弾く', () => {
    const result = run({ requestedCount: String(MAX_REQUESTED_COUNT + 1) })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.requestedCount).toContain(String(MAX_REQUESTED_COUNT))
  })

  it('上限ちょうどは通す', () => {
    expect(run({ requestedCount: String(MAX_REQUESTED_COUNT) }).ok).toBe(true)
  })

  it('知らない分解能を弾く', () => {
    const result = run({ subdivision: '0.125' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.subdivision).toBeDefined()
  })

  it('不正な Sequence ID を弾く', () => {
    const result = run({ sequenceId: 'not-a-ulid' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.sequenceId).toBeDefined()
  })
})

describe('describeSection', () => {
  it('ラベル・範囲・尺を並べる', () => {
    expect(describeSection(SECTIONS[1] as MusicSection)).toBe('chorus 32.0–56.0s（24.0s）')
  })
})

describe('initialStoryboardFormValues', () => {
  it('既定は 8 カット・拍・Sequence 未選択', () => {
    const values = initialStoryboardFormValues(MUSIC_TRACK_ID)

    expect(values.requestedCount).toBe('8')
    expect(values.subdivision).toBe('1')
    expect(values.sequenceId).toBe(NO_SEQUENCE_VALUE)
  })
})
