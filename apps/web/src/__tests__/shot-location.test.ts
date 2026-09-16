import { Location } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { LOCATION_ID, MEDIA_ID, locationJson } from '@/__tests__/fixtures'
import { NO_LOCATION_VALUE } from '@/lib/location-options'
import {
  INVALID_LOCATION_MESSAGE,
  NO_LOCATION_DISPLAY,
  describeLocation,
  toLocationFieldValue,
  toLocationPatch,
} from '@/lib/shot-location'

const location = (overrides: Partial<Location> = {}): Location =>
  Location.parse({ ...locationJson, ...overrides })

describe('describeLocation', () => {
  it('未設定は他の項目と同じ「—」で表す', () => {
    expect(describeLocation(null, [location()])).toBe(NO_LOCATION_DISPLAY)
  })

  it('select の未選択値（空文字）も未設定として扱う', () => {
    expect(describeLocation(NO_LOCATION_VALUE, [location()])).toBe(NO_LOCATION_DISPLAY)
  })

  it('一覧にあるロケーションは名前で表す', () => {
    expect(describeLocation(LOCATION_ID, [location()])).toBe('夜のスタジアム')
  })

  it('一覧を引けないときは ID を出し、設定済みだと分かるようにする', () => {
    expect(describeLocation(LOCATION_ID, [])).toBe(LOCATION_ID)
    expect(
      describeLocation(LOCATION_ID, [location({ id: Location.shape.id.parse(MEDIA_ID) })]),
    ).toBe(LOCATION_ID)
  })
})

describe('toLocationFieldValue', () => {
  it('未設定は select の未選択値になる', () => {
    expect(toLocationFieldValue(null)).toBe(NO_LOCATION_VALUE)
  })

  it('設定済みはロケーション ID がそのまま select の値になる', () => {
    expect(toLocationFieldValue(LOCATION_ID)).toBe(LOCATION_ID)
  })
})

describe('toLocationPatch', () => {
  it('「なし」を選んだら null を送り、付いていた場所を外せる', () => {
    expect(toLocationPatch(NO_LOCATION_VALUE)).toEqual({ ok: true, locationId: null })
  })

  it('ロケーションを選んだら ID をそのまま送る', () => {
    expect(toLocationPatch(LOCATION_ID)).toEqual({ ok: true, locationId: LOCATION_ID })
  })

  it('ULID でない値は送らず、理由を返す', () => {
    expect(toLocationPatch('not-a-ulid')).toEqual({
      ok: false,
      message: INVALID_LOCATION_MESSAGE,
    })
  })
})
