import { describe, expect, it } from 'vitest'
import { describePlacedLyrics } from '@/lib/lyric-clips-api'

/** 歌詞をテロップにした結果の 1 文。置けなかったフレーズを黙らない（L-015）。 */
describe('describePlacedLyrics', () => {
  it('置いた件数と、置き直した件数を言う', () => {
    expect(describePlacedLyrics({ placedCount: 3, replacedCount: 2, timedCount: 3, lineCount: 3 })).toBe(
      '歌詞を 3 件のテロップにしました（前に置いた 2 件を置き直し）。',
    )
  })

  it('時刻の無いフレーズと、置けなかったフレーズも言う', () => {
    expect(describePlacedLyrics({ placedCount: 2, replacedCount: 0, timedCount: 3, lineCount: 5 })).toBe(
      '歌詞を 2 件のテロップにしました。2 フレーズはまだ時刻がありません。1 フレーズは短すぎるか曲の終わりより後なので置いていません。',
    )
  })
})
