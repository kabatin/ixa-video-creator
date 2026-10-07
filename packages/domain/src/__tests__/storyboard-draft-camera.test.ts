import { describe, expect, it } from 'vitest'
import { mergeShotCamera, type ShotCamera } from '../shot/camera.js'
import { StoryboardDraftCamera, StoryboardDraftItem, draftCameraOrNull } from '../storyboard/draft.js'

/**
 * 絵コンテの案が提案するカメラ（ADR-0043。制作者 2026-10-07「内容から判断付くようなものは
 * 自動である程度設定してもらえると嬉しい」）。
 *
 * AI に自由文を書かせるのと違い、**カメラは選択肢なので外した値を落とせる**。
 * それがこの機能を安全に置ける理由なので、落ちることを検査で押さえる。
 */

const aCamera = (overrides: Partial<ShotCamera> = {}): ShotCamera => ({
  size: 'medium',
  angleH: null,
  angle: null,
  lensMm: null,
  movement: null,
  movementIntensity: null,
  ...overrides,
})

describe('StoryboardDraftCamera', () => {
  it('決められた項目だけを持てる', () => {
    expect(StoryboardDraftCamera.parse({ movement: 'tilt', movementIntensity: 'moderate' })).toEqual({
      movement: 'tilt',
      movementIntensity: 'moderate',
    })
  })

  it('空でも読める（1 つも決められなかった案）', () => {
    expect(StoryboardDraftCamera.parse({})).toEqual({})
  })

  it.each([
    { name: '知らない動き', value: { movement: 'zoom_burst' } },
    { name: '知らない景別', value: { size: 'super_wide' } },
    { name: '知らない強さ', value: { movementIntensity: 'very_strong' } },
    { name: '知らない項目', value: { shutterAngle: 180 } },
    { name: '負のレンズ', value: { lensMm: -50 } },
    { name: '未指定にする提案（null）', value: { movement: null } },
  ])('$name は落とす', ({ value }) => {
    expect(StoryboardDraftCamera.safeParse(value).success).toBe(false)
  })
})

describe('draftCameraOrNull', () => {
  it.each([{ camera: {} }, { camera: null }, { camera: undefined }])(
    '決められた項目が無ければ「提案なし」にする',
    ({ camera }) => {
      expect(draftCameraOrNull(camera)).toBeNull()
    },
  )

  it('1 つでもあればそのまま返す', () => {
    expect(draftCameraOrNull({ movement: 'pan' })).toEqual({ movement: 'pan' })
  })
})

describe('mergeShotCamera', () => {
  /** 全体の置換にすると、案が触れていない項目（人が決めた高さなど）が消える。 */
  it('案に入っている項目だけ上書きし、残りはそのまま', () => {
    const current = aCamera({ size: 'wide', angle: 'low', lensMm: 50 })

    expect(mergeShotCamera(current, { movement: 'tilt', movementIntensity: 'subtle' })).toEqual(
      aCamera({ size: 'wide', angle: 'low', lensMm: 50, movement: 'tilt', movementIntensity: 'subtle' }),
    )
  })

  it('空の案では何も変わらない', () => {
    const current = aCamera({ movement: 'pan' })

    expect(mergeShotCamera(current, {})).toEqual(current)
  })

  it('元のカメラを書き換えない（新しい値を返す）', () => {
    const current = aCamera()

    mergeShotCamera(current, { size: 'closeup' })

    expect(current.size).toBe('medium')
  })
})

/**
 * 案そのもの（`StoryboardDraftItem`）の読み方。
 * **カメラを返さない口（スタブ・前の run）もそのまま読める**ことを押さえる。
 */
describe('StoryboardDraftItem の camera', () => {
  const base = {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    runId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
    shotId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
    description: '立ち上がる',
    mood: null,
    reason: 'サビの頭だから',
    adoptedAt: null,
    createdAt: new Date('2026-10-07T00:00:00.000Z'),
  }

  it('省略されていれば「提案なし」', () => {
    expect(StoryboardDraftItem.parse(base).camera).toBeNull()
  })

  it('空の提案は「提案なし」に畳む', () => {
    expect(StoryboardDraftItem.parse({ ...base, camera: {} }).camera).toBeNull()
  })

  it('決められた項目はそのまま残る', () => {
    expect(StoryboardDraftItem.parse({ ...base, camera: { movement: 'tilt' } }).camera).toEqual({
      movement: 'tilt',
    })
  })

  it('知らない値の案は、案ごと落とす（黙って捨てない）', () => {
    expect(StoryboardDraftItem.safeParse({ ...base, camera: { movement: 'zoom_burst' } }).success).toBe(
      false,
    )
  })
})
