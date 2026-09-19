import { CharacterId, CharacterLookId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import {
  castWithCharacter,
  droppedFileKind,
  encodeAssetDrag,
  lookKeyFromName,
  parseAssetDrag,
} from '@/lib/asset-actions'

const A = CharacterId.parse('01ARZ3NDEKTSV4RRFFQ69G5FC0')
const B = CharacterId.parse('01ARZ3NDEKTSV4RRFFQ69G5FC1')
const LOOK = CharacterLookId.parse('01ARZ3NDEKTSV4RRFFQ69G5FC2')

describe('lookKeyFromName', () => {
  it('英数字を大文字の key にする', () => {
    expect(lookKeyFromName('Stage outfit 2', [])).toBe('STAGE_OUTFIT_2')
  })

  it('英数字が無い名前は LOOK', () => {
    expect(lookKeyFromName('通常', [])).toBe('LOOK')
  })

  it('重なれば番号を付ける', () => {
    expect(lookKeyFromName('通常', ['LOOK', 'LOOK_2'])).toBe('LOOK_3')
  })
})

describe('ドラッグの中身', () => {
  it('往復する', () => {
    expect(parseAssetDrag(encodeAssetDrag({ kind: 'character', id: A }))).toEqual({
      kind: 'character',
      id: A,
    })
  })

  it('他から落とされた文字は null', () => {
    expect(parseAssetDrag('hello')).toBeNull()
    expect(parseAssetDrag('{"kind":"shot","id":"x"}')).toBeNull()
  })
})

describe('castWithCharacter', () => {
  it('最初の 1 人は主役、次は secondary で末尾', () => {
    const first = castWithCharacter([], A, LOOK)
    expect(first).toEqual([{ characterId: A, lookId: LOOK, prominence: 'primary', order: 0 }])
    const second = castWithCharacter(first ?? [], B, LOOK)
    expect(second?.[1]).toEqual({ characterId: B, lookId: LOOK, prominence: 'secondary', order: 1 })
  })

  it('既に出ていれば null（二重に足さない）', () => {
    const cast = castWithCharacter([], A, LOOK) ?? []
    expect(castWithCharacter(cast, A, LOOK)).toBeNull()
  })
})

describe('droppedFileKind', () => {
  it.each([
    [{ type: 'audio/wav', name: 'a.bin' }, 'audio'],
    [{ type: '', name: 'Theme.MP3' }, 'audio'],
    [{ type: 'image/png', name: 'x' }, 'image'],
    [{ type: '', name: 'ref.jpeg' }, 'image'],
    [{ type: 'application/pdf', name: 'a.pdf' }, 'other'],
  ] as const)('%o → %s', (file, kind) => {
    expect(droppedFileKind(file)).toBe(kind)
  })
})
