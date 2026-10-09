import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 合言葉のクッキーの名前は 3 か所に書いてある（API の門・Next のサーバ側・Next の middleware）。
 * **1 つでもズレると、入ったのに入り口へ送られ続ける。** 書き写しを突き合わせる。
 */
const read = (path: string): string => readFileSync(join(__dirname, '..', '..', '..', '..', path), 'utf8')
const nameIn = (source: string): string | undefined => /SESSION_COOKIE = '([^']+)'/.exec(source)?.[1]

describe('合言葉のクッキーの名前', () => {
  it('API の門・サーバ側・middleware で同じ', () => {
    const api = nameIn(read('apps/api/src/auth/gate.ts'))
    expect(api).toBe('ixa_session')
    expect(nameIn(read('apps/web/src/lib/server-api-client.ts'))).toBe(api)
    expect(nameIn(read('apps/web/src/middleware.ts'))).toBe(api)
  })
})
