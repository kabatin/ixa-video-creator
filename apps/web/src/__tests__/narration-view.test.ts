import { describe, expect, it } from 'vitest'
import { bulkSpeakSummary, lineStatus, narrationLengthNote } from '@/lib/narration-view'

/** ナレーションのパネルに出す言葉（ADR-0038）。長さは format-time の書式で、内部の名前は出さない。 */

describe('narrationLengthNote', () => {
  it('作品の長さが無ければ合計だけ', () => {
    expect(narrationLengthNote(14.4, null)).toEqual({ text: '合計 約 14 秒', tone: 'muted' })
  })

  it('作品の長さに収まれば並べて出す', () => {
    expect(narrationLengthNote(14.4, 15)).toEqual({ text: '合計 約 14 秒 / 作品の長さ 約 15 秒', tone: 'muted' })
  })

  it('作品の長さより長ければ、どれだけ長いかとどうするかを言う', () => {
    expect(narrationLengthNote(18.2, 15)).toEqual({
      text: '合計 約 18 秒 / 作品の長さ 約 15 秒。約 3 秒長いので、行を削るか速さを上げてください',
      tone: 'warn',
    })
  })
})

describe('lineStatus', () => {
  const base = { job: null, stale: false, takes: [{ id: 't' }], selectedTakeId: 't' }

  it('作っている途中・失敗・作り直しが要る・声がまだ無い を言い分ける', () => {
    expect(lineStatus({ ...base, job: { status: 'queued', error: null } })).toEqual({ text: '声を作っています…', tone: 'muted' })
    expect(lineStatus({ ...base, job: { status: 'running', error: null } })).toEqual({ text: '声を作っています…', tone: 'muted' })
    expect(lineStatus({ ...base, job: { status: 'failed', error: { message: '回数の上限に達しました' } } })).toEqual({
      text: '声を作れませんでした: 回数の上限に達しました',
      tone: 'danger',
    })
    expect(lineStatus({ ...base, stale: true })).toEqual({ text: '原稿か声を変えたので、作り直しが要ります', tone: 'warn' })
    expect(lineStatus({ ...base, takes: [], selectedTakeId: null })).toEqual({ text: '声はまだありません', tone: 'muted' })
  })

  it('できていて新しければ何も言わない', () => {
    expect(lineStatus(base)).toBeNull()
    expect(lineStatus({ ...base, job: { status: 'succeeded', error: null } })).toBeNull()
  })
})

describe('bulkSpeakSummary', () => {
  it('頼んだ・使い回した・飛ばした（声が未定・作っている途中・作り直し不要）を数で言う', () => {
    expect(
      bulkSpeakSummary({ jobIds: ['a', 'b'], reusedTakeIds: ['c'], skipped: { noVoice: 2, active: 1, upToDate: 3 } }),
    ).toBe('2 行を声にしています。1 行は前に作った声を使いました。声が決まっていない行が 2 行、作っている途中の行が 1 行あります。')
  })

  it('何もしなかったら、そう言う', () => {
    expect(bulkSpeakSummary({ jobIds: [], reusedTakeIds: [], skipped: { noVoice: 0, active: 0, upToDate: 4 } })).toBe(
      '声にする行はありません（どの行も声ができています）。',
    )
  })
})
