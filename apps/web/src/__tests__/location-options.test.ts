import { Location } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { LOCATION_ID, MEDIA_ID, locationJson } from '@/__tests__/fixtures'
import { NO_LOCATION_VALUE, toLocationOptions } from '@/lib/location-options'

const location = (overrides: Partial<Location> = {}): Location =>
  Location.parse({ ...locationJson, ...overrides })

describe('toLocationOptions', () => {
  it('先頭は「なし」で、値は未選択を表す', () => {
    const [first] = toLocationOptions([])

    expect(first).toEqual({ value: NO_LOCATION_VALUE, label: 'なし' })
  })

  it('ロケーションが無いときは「なし」だけを返す', () => {
    expect(toLocationOptions([])).toHaveLength(1)
  })

  it('値はロケーション ID で、ラベルに名前と参照画像の枚数が出る', () => {
    const options = toLocationOptions([location()])

    expect(options[1]).toEqual({
      value: LOCATION_ID,
      label: '夜のスタジアム（参照画像 1 枚）',
    })
  })

  it('参照画像が無いロケーションはそうと分かるラベルになる', () => {
    const options = toLocationOptions([location({ referenceAssetIds: [] })])

    expect(options[1]?.label).toBe('夜のスタジアム（参照画像なし）')
  })

  it('並び順は渡された順のまま変えない', () => {
    const options = toLocationOptions([
      location({ name: 'A' }),
      location({ id: Location.shape.id.parse(MEDIA_ID), name: 'B' }),
    ])

    expect(options.map((option) => option.label)).toEqual([
      'なし',
      'A（参照画像 1 枚）',
      'B（参照画像 1 枚）',
    ])
  })
})
