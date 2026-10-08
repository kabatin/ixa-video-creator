import { describe, expect, it } from 'vitest'
import { TakeId, newId } from '../common/ids.js'
import {
  ALREADY_UPSCALED_REASON,
  UPSCALE_EXISTS_REASON,
  UPSCALE_IN_PROGRESS_REASON,
  UPSCALE_REASON,
  upscaleBlocker,
  upscaleJobViolation,
  type UpscaleSourceTakeWithParent,
} from '../generation/upscale-job.js'

/**
 * 解像度を上げる仕事の規則（ADR-0044）。
 * **押しても必ず断られる操作を、押せる形で画面に出さないため**の判定でもある。
 */

const SOURCE = newId(TakeId)

const take = (
  id = SOURCE,
  regenerationReason: string | null = null,
): { readonly id: TakeId; readonly regenerationReason: string | null } => ({ id, regenerationReason })

const sibling = (
  parentTakeId: TakeId | null,
  regenerationReason: string | null,
): UpscaleSourceTakeWithParent => ({ id: newId(TakeId), parentTakeId, regenerationReason })

describe('upscaleBlocker', () => {
  it('ふつうの Take は上げられる', () => {
    expect(upscaleBlocker({ take: take(), siblings: [], activeSourceTakeIds: [] })).toBeNull()
  })

  /** 上げたものをさらに上げても、粗が重なるだけで良くならない。 */
  it('すでに上げた Take は、もう上げない', () => {
    expect(
      upscaleBlocker({ take: take(SOURCE, UPSCALE_REASON), siblings: [], activeSourceTakeIds: [] }),
    ).toBe(ALREADY_UPSCALED_REASON)
  })

  /** 夜にまとめて押す操作なので、同じ選択で 2 回押されうる。 */
  it('いま上げている最中なら、二重に積まない', () => {
    expect(
      upscaleBlocker({ take: take(), siblings: [], activeSourceTakeIds: [SOURCE] }),
    ).toBe(UPSCALE_IN_PROGRESS_REASON)
  })

  it('すでに上げたものがあるなら、もう一度作らない', () => {
    expect(
      upscaleBlocker({
        take: take(),
        siblings: [sibling(SOURCE, UPSCALE_REASON)],
        activeSourceTakeIds: [],
      }),
    ).toBe(UPSCALE_EXISTS_REASON)
  })

  /**
   * **別の Take から作られたものを、自分のものと数えない。**
   * ここを緩めると、1 本上げただけで同じ Shot の他の Take が上げられなくなる。
   */
  it('ほかの Take を上げたものは、数に入れない', () => {
    const other = newId(TakeId)
    expect(
      upscaleBlocker({
        take: take(),
        siblings: [sibling(other, UPSCALE_REASON)],
        activeSourceTakeIds: [],
      }),
    ).toBeNull()
  })

  /** 作り直し（「本番で作り直す」）の子は、上げたものではない。 */
  it('理由が違う子は、上げたものと数えない', () => {
    expect(
      upscaleBlocker({
        take: take(),
        siblings: [sibling(SOURCE, '本番で作り直す')],
        activeSourceTakeIds: [],
      }),
    ).toBeNull()
  })
})

describe('upscaleJobViolation', () => {
  it('成り立っている組み合わせは通す', () => {
    const takeId = newId(TakeId)
    expect(upscaleJobViolation({ status: 'queued', takeId: null, error: null })).toBeNull()
    expect(upscaleJobViolation({ status: 'succeeded', takeId, error: null })).toBeNull()
    expect(
      upscaleJobViolation({
        status: 'failed',
        takeId: null,
        error: { code: 'x', message: 'だめ', retryable: false },
      }),
    ).toBeNull()
  })

  it('成功したのに Take が無ければ止める', () => {
    expect(upscaleJobViolation({ status: 'succeeded', takeId: null, error: null })).toContain('Take')
  })

  it('失敗したのに理由が無ければ止める', () => {
    expect(upscaleJobViolation({ status: 'failed', takeId: null, error: null })).toContain('理由')
  })

  it('終わっていないのに Take があれば止める', () => {
    expect(
      upscaleJobViolation({ status: 'running', takeId: newId(TakeId), error: null }),
    ).toContain('終わっていない')
  })
})
