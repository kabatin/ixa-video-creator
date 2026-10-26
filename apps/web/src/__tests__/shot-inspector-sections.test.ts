import { TakeId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import {
  shotSectionDefaultOpen,
  shotSectionSummary,
  shotSectionTocLabel,
  type ShotSectionFacts,
} from '@/lib/shot-inspector-sections'

/** Shot のインスペクターの区切りの要約・目次・既定の開け閉め（2026-10-26）。 */

const TAKE_A = TakeId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA1')
const TAKE_B = TakeId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA2')

const facts = (patch: Partial<ShotSectionFacts> = {}, shot: Partial<ShotSectionFacts['shot']> = {}): ShotSectionFacts => ({
  shot: {
    description: '',
    dialogue: [],
    selectedTakeId: null,
    startSec: 0,
    durationSec: 6,
    camera: { size: 'medium', angleH: null, angle: null, lensMm: null, movement: null, movementIntensity: null },
    ...shot,
  },
  locationName: null,
  hasStartFrame: null,
  takes: null,
  ...patch,
})

describe('shotSectionSummary', () => {
  it('Take は本数と採用中の Take を言う', () => {
    const takes = [
      { id: TAKE_A, index: 1 },
      { id: TAKE_B, index: 6 },
    ]
    expect(shotSectionSummary('take', facts({ takes }, { selectedTakeId: TAKE_B }))).toBe('2 本・採用 Take 6')
    expect(shotSectionSummary('take', facts({ takes }))).toBe('2 本・採用 なし')
    // 読めていないのを 0 本と言わない。
    expect(shotSectionSummary('take', facts())).toBe('読み込んでいます')
  })

  it('時間は時刻と尺の書式で言う（生の秒を出さない）', () => {
    expect(shotSectionSummary('time', facts({}, { startSec: 15.66, durationSec: 5.33 }))).toBe('0:15.66 / 5.33s')
  })

  it('絵は最初のフレームが分からないうちは何も言わない', () => {
    expect(shotSectionSummary('frame', facts())).toBeUndefined()
    expect(shotSectionSummary('frame', facts({ hasStartFrame: true }))).toBe('最初のフレームあり')
    expect(shotSectionSummary('frame', facts({ hasStartFrame: false }))).toBe('最初のフレームなし')
  })
})

describe('shotSectionDefaultOpen', () => {
  it('絵は最初のフレームが付いていると分かったときだけ畳む', () => {
    expect(shotSectionDefaultOpen('frame', facts({ hasStartFrame: null }))).toBe(true)
    expect(shotSectionDefaultOpen('frame', facts({ hasStartFrame: false }))).toBe(true)
    expect(shotSectionDefaultOpen('frame', facts({ hasStartFrame: true }))).toBe(false)
  })

  it('セリフは行があるときだけ開く', () => {
    const line = { speakerId: null, text: 'ねえ', offscreen: false, translation: null } as unknown as ShotSectionFacts['shot']['dialogue'][number]
    expect(shotSectionDefaultOpen('dialogue', facts())).toBe(false)
    expect(shotSectionDefaultOpen('dialogue', facts({}, { dialogue: [line] }))).toBe(true)
  })
})

describe('shotSectionTocLabel', () => {
  it('Take は読めたら本数を添える', () => {
    expect(shotSectionTocLabel('take', facts())).toBe('Take')
    expect(shotSectionTocLabel('take', facts({ takes: [] }))).toBe('Take 0本')
  })
})
