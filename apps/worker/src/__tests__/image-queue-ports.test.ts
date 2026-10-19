import { describe, expect, it } from 'vitest'
import { imageQueuePorts } from '../image-wiring.js'

/**
 * image キューへ積む口（ADR-0055）。チェックの手順は**ジョブ ID で 1 つにまとめる**（レビューの指摘 2026-10-19）。
 * 同じ絵のチェックが 2 つ同時に走ると、Claude に 2 回払い、やり直しも 2 つ積みかねない。
 */

const recording = () => {
  const added: { name: string; data: unknown; options: unknown }[] = []
  return {
    added,
    queue: {
      add: (name: string, data: { readonly imageJobId: string; readonly step?: 'check' }, options?: unknown) => {
        added.push({ name, data, options })
        return Promise.resolve()
      },
    },
  }
}

describe('imageQueuePorts', () => {
  it('チェックの手順は check-<ジョブ> の ID で積み、終わったら消す（後でまた積める）', async () => {
    const { added, queue } = recording()
    await imageQueuePorts(queue).check('01ARZ3NDEKTSV4RRFFQ69G5FAV' as never)
    expect(added).toEqual([
      {
        name: 'check',
        data: { imageJobId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', step: 'check' },
        options: { jobId: 'check-01ARZ3NDEKTSV4RRFFQ69G5FAV', removeOnComplete: true, removeOnFail: true },
      },
    ])
  })

  it('描く手順は API と同じ名前（draw）で積む', async () => {
    const { added, queue } = recording()
    await imageQueuePorts(queue).draw('01ARZ3NDEKTSV4RRFFQ69G5FAV' as never)
    expect(added).toEqual([{ name: 'draw', data: { imageJobId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }, options: undefined }])
  })
})
