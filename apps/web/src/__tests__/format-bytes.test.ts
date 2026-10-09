import { describe, expect, it } from 'vitest'
import { formatBytes } from '@/lib/format-bytes'

describe('バイト数の表示', () => {
  it.each([
    [0, '0 B'],
    [-1, '0 B'],
    [512, '512 B'],
    [1024, '1.0 KB'],
    [34_603_008, '33.0 MB'],
  ])('%d → %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected)
  })
})
