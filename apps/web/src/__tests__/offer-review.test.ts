import type { ShotId, Take, TakeId } from '@ixa/domain'
import { describe, expect, it, vi } from 'vitest'
import { REVIEW_LATER_GUIDANCE, offerReviewAfterGeneration } from '@/lib/offer-review'

/**
 * 生成が終わったら、自動レビューをするか聞く（制作者の判断 2026-09-25）。
 *
 * 以前は生成後に何も起きず、Shot は「レビュー待ち」のまま、Take には「自動レビュー未実施」と
 * 出ていた。自動レビューは勝手には始まらず、インスペクター最下部のボタンを押す必要があった。
 * **待っているように見えて、何も来ない。**
 *
 * 断ったときも、あとでどこから実行できるかを言う。
 */

const shotA = 'shot-a' as ShotId
const shotB = 'shot-b' as ShotId

const take = (id: string, reviewStatus: Take['reviewStatus']): Take =>
  ({ id: id as TakeId, reviewStatus }) as Take

const deps = (confirmAnswer: boolean, takesByShot: Record<string, readonly Take[]>) => ({
  api: {
    listTakes: vi.fn((shotId: ShotId) => Promise.resolve([...(takesByShot[shotId] ?? [])])),
    requestReview: vi.fn<(takeId: TakeId) => Promise<unknown>>(() =>
      Promise.resolve({ accepted: true }),
    ),
  },
  confirm: vi.fn<(message: string) => boolean>(() => confirmAnswer),
  notify: vi.fn<(message: string) => void>(),
})

describe('offerReviewAfterGeneration', () => {
  it('はいなら、まだレビューしていない Take だけにレビューを頼む', async () => {
    const d = deps(true, {
      [shotA]: [take('t1', 'pending'), take('t0', 'passed')],
      [shotB]: [take('t2', 'pending')],
    })

    await offerReviewAfterGeneration({ shotIds: [shotA, shotB], ...d })

    expect(d.confirm).toHaveBeenCalledTimes(1)
    expect(d.api.requestReview.mock.calls.map(([id]) => id)).toEqual(['t1', 't2'])
    expect(d.notify).toHaveBeenCalledWith(expect.stringContaining('2 本'))
  })

  it('聞くときに、何本をレビューするかを言う', async () => {
    const d = deps(true, { [shotA]: [take('t1', 'pending'), take('t2', 'pending')] })

    await offerReviewAfterGeneration({ shotIds: [shotA], ...d })

    expect(d.confirm.mock.calls[0]?.[0]).toContain('2 本')
  })

  it('いいえなら頼まず、あとでどこから実行できるかを伝える', async () => {
    const d = deps(false, { [shotA]: [take('t1', 'pending')] })

    await offerReviewAfterGeneration({ shotIds: [shotA], ...d })

    expect(d.api.requestReview).not.toHaveBeenCalled()
    expect(d.notify).toHaveBeenCalledWith(REVIEW_LATER_GUIDANCE)
    expect(REVIEW_LATER_GUIDANCE).toContain('インスペクター')
    expect(REVIEW_LATER_GUIDANCE).toContain('レビューを実行')
  })

  it('レビューしていない Take が無ければ聞かない', async () => {
    const d = deps(true, { [shotA]: [take('t1', 'passed')] })

    await offerReviewAfterGeneration({ shotIds: [shotA], ...d })

    expect(d.confirm).not.toHaveBeenCalled()
    expect(d.api.requestReview).not.toHaveBeenCalled()
  })

  it('頼むのに失敗したら黙らず伝える', async () => {
    const d = deps(true, { [shotA]: [take('t1', 'pending')] })
    d.api.requestReview.mockRejectedValueOnce(new Error('offline'))

    await offerReviewAfterGeneration({ shotIds: [shotA], ...d })

    expect(d.notify).toHaveBeenCalledWith(expect.stringContaining('始められませんでした'))
  })
})
