import { CharacterLook, ShotCharacter } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { CHARACTER_ID, LOOK_ID, SHOT_ID, characterJson, lookJson } from '@/__tests__/fixtures'
import { WireCharacter } from '@/lib/character-schemas'
import {
  DUPLICATE_CHARACTER_MESSAGE,
  FOREIGN_LOOK_MESSAGE,
  LOOK_MISSING_MESSAGE,
  LOOK_REQUIRED_MESSAGE,
  ORDER_INVALID_MESSAGE,
  CHARACTER_REQUIRED_MESSAGE,
  UNSELECTED,
  applyCharacterChange,
  defaultLookId,
  describeCharacter,
  emptyCastRow,
  looksOf,
  nextOrder,
  removeRow,
  replaceRow,
  toCastRows,
  toCharacterOptions,
  toLookOptions,
  validateCast,
  type CastRow,
} from '@/lib/shot-cast-form'

const OTHER_CHARACTER_ID = '01ARZ3NDEKTSV4RRFFQ69G5FC5'
const SECOND_LOOK_ID = '01ARZ3NDEKTSV4RRFFQ69G5FC6'
const OTHER_LOOK_ID = '01ARZ3NDEKTSV4RRFFQ69G5FC7'

const takepi = WireCharacter.parse(characterJson)
const other = WireCharacter.parse({
  ...characterJson,
  id: OTHER_CHARACTER_ID,
  name: 'aoi',
  displayName: 'アオイ',
})

/** 既定の Look。並びの先頭ではない位置に置き、「先頭」ではなく「既定」を選んでいるか見る。 */
const defaultLook = CharacterLook.parse(lookJson)
const extraLook = CharacterLook.parse({
  ...lookJson,
  id: SECOND_LOOK_ID,
  key: 'IXA_CUP_NOW',
  name: 'iXA CUP 2026',
  isDefault: false,
})
/** 別のキャラクターの Look。他人の衣装を指すと API が 422 を返す。 */
const foreignLook = CharacterLook.parse({
  ...lookJson,
  id: OTHER_LOOK_ID,
  characterId: OTHER_CHARACTER_ID,
  key: 'AOI_DEFAULT',
  name: 'アオイ既定',
  isDefault: true,
})

const CHARACTERS = [takepi, other]
const LOOKS = [extraLook, defaultLook, foreignLook]

const row = (patch: Partial<CastRow> = {}): CastRow => ({
  key: 'row-1',
  characterId: CHARACTER_ID,
  lookId: LOOK_ID,
  prominence: 'primary',
  order: '0',
  ...patch,
})

describe('Look の解決', () => {
  it('looksOf はそのキャラクターの Look だけに絞る', () => {
    expect(looksOf(CHARACTER_ID, LOOKS).map((look) => look.id)).toEqual([SECOND_LOOK_ID, LOOK_ID])
  })

  it('defaultLookId は先頭ではなく isDefault の Look を選ぶ', () => {
    expect(defaultLookId(looksOf(CHARACTER_ID, LOOKS))).toBe(LOOK_ID)
  })

  it('defaultLookId は既定が無ければ先頭、Look が無ければ未選択を返す', () => {
    expect(defaultLookId([extraLook])).toBe(SECOND_LOOK_ID)
    expect(defaultLookId([])).toBe(UNSELECTED)
  })

  it('applyCharacterChange はキャラクターを変えたら Look も付け替える', () => {
    const rows = [row()]
    const next = applyCharacterChange(rows, 'row-1', OTHER_CHARACTER_ID, LOOKS)

    expect(next[0]).toEqual({ ...row(), characterId: OTHER_CHARACTER_ID, lookId: OTHER_LOOK_ID })
    // 元の配列は変えない
    expect(rows[0]?.lookId).toBe(LOOK_ID)
  })

  it('applyCharacterChange は未選択に戻したら Look も外す', () => {
    const next = applyCharacterChange([row()], 'row-1', UNSELECTED, LOOKS)
    expect(next[0]?.lookId).toBe(UNSELECTED)
  })
})

describe('行の組み立て', () => {
  it('toCastRows は order 昇順に並べ、key を characterId にする', () => {
    const cast = [
      ShotCharacter.parse({
        shotId: SHOT_ID,
        characterId: OTHER_CHARACTER_ID,
        lookId: OTHER_LOOK_ID,
        prominence: 'background',
        order: 2,
      }),
      ShotCharacter.parse({
        shotId: SHOT_ID,
        characterId: CHARACTER_ID,
        lookId: LOOK_ID,
        prominence: 'primary',
        order: 1,
      }),
    ]

    expect(toCastRows(cast).map((r) => [r.key, r.order])).toEqual([
      [CHARACTER_ID, '1'],
      [OTHER_CHARACTER_ID, '2'],
    ])
  })

  it('nextOrder は最大の次を返し、行が無ければ 0', () => {
    expect(nextOrder([])).toBe(0)
    expect(nextOrder([row({ order: '3' }), row({ key: 'row-2', order: '1' })])).toBe(4)
    // 壊れた入力は数えない
    expect(nextOrder([row({ order: 'abc' })])).toBe(0)
  })

  it('replaceRow / removeRow は元の配列を変えない', () => {
    const rows = [row(), row({ key: 'row-2' })]

    expect(replaceRow(rows, 'row-2', { prominence: 'background' })[1]?.prominence).toBe('background')
    expect(removeRow(rows, 'row-1').map((r) => r.key)).toEqual(['row-2'])
    expect(rows[1]?.prominence).toBe('primary')
  })

  it('emptyCastRow は未選択で始まる', () => {
    expect(emptyCastRow('new-1', 2)).toEqual({
      key: 'new-1',
      characterId: UNSELECTED,
      lookId: UNSELECTED,
      prominence: 'secondary',
      order: '2',
    })
  })
})

describe('選択肢', () => {
  it('toCharacterOptions は未選択を先頭に置く', () => {
    const options = toCharacterOptions(CHARACTERS)
    expect(options[0]?.value).toBe(UNSELECTED)
    expect(options.map((o) => o.value).slice(1)).toEqual([CHARACTER_ID, OTHER_CHARACTER_ID])
  })

  it('toLookOptions は既定の Look がそれと分かるようにする', () => {
    const labels = toLookOptions(looksOf(CHARACTER_ID, LOOKS)).map((o) => o.label)
    expect(labels).toContain('iXA CUP 2019（既定）')
    expect(labels).toContain('iXA CUP 2026')
  })

  it('describeCharacter は名前を引けないとき ID を出す（付いていないと誤解させない）', () => {
    expect(describeCharacter(CHARACTER_ID, CHARACTERS)).toBe('タケピ')
    expect(describeCharacter(OTHER_LOOK_ID, [])).toBe(OTHER_LOOK_ID)
  })
})

describe('validateCast', () => {
  it('正しい行は entries に落ちる。order は数値になる', () => {
    const result = validateCast([row({ order: '2' })], LOOKS)

    expect(result).toEqual({
      ok: true,
      entries: [
        { characterId: CHARACTER_ID, lookId: LOOK_ID, prominence: 'primary', order: 2 },
      ],
    })
  })

  it('行が 0 件でも成功する（全員を外す操作が通る必要がある）', () => {
    expect(validateCast([], LOOKS)).toEqual({ ok: true, entries: [] })
  })

  it('キャラクター未選択を弾く', () => {
    const result = validateCast([row({ characterId: UNSELECTED, lookId: UNSELECTED })], LOOKS)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors['row-1']?.characterId).toBe(CHARACTER_REQUIRED_MESSAGE)
  })

  it('Look 未選択を弾く（lookId は必須。既定に黙って落とさない）', () => {
    const result = validateCast([row({ lookId: UNSELECTED })], LOOKS)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors['row-1']?.lookId).toBe(LOOK_REQUIRED_MESSAGE)
  })

  it('Look を 1 つも持たないキャラクターは「選べ」ではなく「作れ」と言う', () => {
    const result = validateCast([row({ lookId: UNSELECTED })], [foreignLook])

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors['row-1']?.lookId).toBe(LOOK_MISSING_MESSAGE)
  })

  it('他のキャラクターの Look を弾く', () => {
    const result = validateCast([row({ lookId: OTHER_LOOK_ID })], LOOKS)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors['row-1']?.lookId).toBe(FOREIGN_LOOK_MESSAGE)
  })

  it('読み込めていない Look は「他人のもの」と決めつけない（判定は API に委ねる）', () => {
    expect(validateCast([row()], []).ok).toBe(true)
  })

  it('同じキャラクターの重複を両方の行に出す', () => {
    const result = validateCast([row(), row({ key: 'row-2' })], LOOKS)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors['row-1']?.characterId).toBe(DUPLICATE_CHARACTER_MESSAGE)
    expect(result.errors['row-2']?.characterId).toBe(DUPLICATE_CHARACTER_MESSAGE)
  })

  it('表示順が整数でないものを弾く', () => {
    for (const order of ['', ' ', '-1', '1.5', 'abc']) {
      const result = validateCast([row({ order })], LOOKS)
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.errors['row-1']?.order).toBe(ORDER_INVALID_MESSAGE)
    }
  })

  it('映り方が既定の 3 つ以外なら弾く', () => {
    const result = validateCast([row({ prominence: 'hero' })], LOOKS)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors['row-1']?.prominence).toBeDefined()
  })

  it('ULID でない ID は zod に判定させる（画面側で形を持たない）', () => {
    const result = validateCast([row({ characterId: 'not-a-ulid', lookId: 'not-a-ulid' })], LOOKS)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors['row-1']).toBeDefined()
  })
})
