import { describe, expect, it } from 'vitest'
import { DEMO_SOURCE_CAPS, parseDemoSource } from '../demo-project/source-wire.js'

/**
 * 見本の目録の中身（source）の配列の上限（ADR-0067）。入れる側は丸ごと読んで書くので、いくらでも並べさせない。
 * 上限は見本としては十分に大きく、決まった数。中身を確かめる前に数で断る（断った理由に「多すぎます」が出る）。
 */

const many = (n: number): readonly Record<string, unknown>[] => Array.from({ length: n }, () => ({}))

/** 上限の場所に `n` 個の空の要素を置いた中身。入れ子の配列は 1 つ目の親の下に置く。 */
const sourceWith = (path: string, n: number): Record<string, unknown> => {
  const keys = path.split('[].')
  const leaf = keys.at(-1) ?? ''
  // 内側から組む: いちばん内側の配列に n 個、その外は 1 つずつの親。
  return keys.slice(0, -1).reduceRight<Record<string, unknown>>((inner, key) => ({ [key]: [inner] }), { [leaf]: many(n) })
}

const failureOf = (json: unknown): string => {
  try {
    parseDemoSource(json)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return '（通った）'
}

describe('source の配列の上限', () => {
  it('上限は決まった数で、見本には十分', () => {
    expect(Object.keys(DEMO_SOURCE_CAPS).length).toBeGreaterThanOrEqual(15)
    for (const cap of Object.values(DEMO_SOURCE_CAPS)) expect(Number.isInteger(cap.max) && cap.max >= 10).toBe(true)
  })

  it.each(Object.entries(DEMO_SOURCE_CAPS))('%s は %o を超えると数で断る', (path, cap) => {
    expect(failureOf(sourceWith(path, cap.max + 1))).toContain(`${cap.label}が多すぎます`)
    // 上限ちょうどなら数では断らない（中身の形で断る）。
    expect(failureOf(sourceWith(path, cap.max))).not.toContain('多すぎます')
  })
})
