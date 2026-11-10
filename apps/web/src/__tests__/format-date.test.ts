import { describe, expect, it } from 'vitest'
import { formatWhen } from '@/lib/access-key-display'
import { formatEditBatchTime } from '@/lib/edit-history'
import { formatDateTime } from '@/lib/format-date'

/**
 * 日時の書式は `lib/format-date.ts` の 1 箇所が正。以前は同じ設定の書式が 4 か所に書き写されていた。
 * **時間帯は東京に固定する。** サーバと閲覧側で同じ文字列になる（画面を組み直したときに食い違わない）。
 */
describe('formatDateTime', () => {
  it('東京の時刻で「年/月/日 時:分」', () => {
    expect(formatDateTime(new Date('2026-11-10T05:02:00.000Z'))).toBe('2026/11/10 14:02')
  })

  it('日付の変わり目も東京で数える', () => {
    expect(formatDateTime(new Date('2026-10-08T15:00:00.000Z'))).toBe('2026/10/09 00:00')
  })
})

describe('日時の書式を書き写さない', () => {
  const iso = '2026-11-10T05:02:00.000Z'

  it('鍵の画面・編集の記録は同じ書式を通す', () => {
    expect(formatWhen(iso)).toBe(formatDateTime(new Date(iso)))
    expect(formatEditBatchTime(iso)).toBe(formatDateTime(new Date(iso)))
  })
})
