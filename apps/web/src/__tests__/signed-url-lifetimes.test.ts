import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { POSTER_URL_LIFETIME_SEC, TIMELINE_URL_LIFETIME_SEC } from '@/lib/signed-url-renewal'

/**
 * 画面が「いつ取り直すか」に使う有効期間は、API の定数の書き写し（`signed-url-renewal.ts`）。
 * **API が期限を延ばしても縮めても、画面は気づかない。** 縮めたのに画面が古い値のままだと、
 * 取り直す前に切れて素材が読めなくなる。書き写しを突き合わせる（`auth-cookie-name.test.ts` と同じ形）。
 */
const read = (path: string): string => readFileSync(join(__dirname, '..', '..', '..', '..', path), 'utf8')
const constantIn = (source: string, name: string): number | undefined => {
  const found = new RegExp(`export const ${name} = ([0-9_]+)`).exec(source)?.[1]
  return found === undefined ? undefined : Number(found.replaceAll('_', ''))
}

describe('署名付き URL の有効期間の書き写し', () => {
  it('サムネイル一覧は API の既定（DEFAULT_SIGNED_URL_EXPIRES_SEC）で発行され、画面も同じ値で数える', () => {
    const media = read('apps/api/src/routes/media.ts')
    expect(constantIn(media, 'DEFAULT_SIGNED_URL_EXPIRES_SEC')).toBe(POSTER_URL_LIFETIME_SEC)
    const posters = read('apps/api/src/routes/shot-posters.ts')
    expect(posters).toContain('signedGetUrl(key, DEFAULT_SIGNED_URL_EXPIRES_SEC)')
  })

  it('タイムラインと Take 比較は TIMELINE_SIGNED_URL_EXPIRES_SEC で発行され、画面も同じ値で数える', () => {
    const timeline = read('apps/api/src/routes/timeline.ts')
    expect(constantIn(timeline, 'TIMELINE_SIGNED_URL_EXPIRES_SEC')).toBe(TIMELINE_URL_LIFETIME_SEC)
    const compare = read('apps/api/src/routes/shot-compare.ts')
    expect(compare).toContain('TIMELINE_SIGNED_URL_EXPIRES_SEC)')
  })
})
