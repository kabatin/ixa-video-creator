import { describe, expect, it } from 'vitest'
import {
  CreateGenerationJobInput,
  MAX_REGENERATION_REASON_LENGTH,
  ShotId,
  TakeId,
  UpdateGenerationJobPatch,
  newId,
} from '../index.js'

/**
 * GenerationJob の系譜（DOMAIN.md §10）。
 *
 * 系譜を書けるのは作成時の 1 回だけである。Take は Immutable（ADR-0003）なので、
 * ここで取りこぼすと「何の作り直しなのか」を後から埋める手段が無い。
 * 積み忘れが静かに通らないことを、ここで型ではなく値として確かめる。
 */

const baseInput = () => ({
  shotId: newId(ShotId),
  specHash: 'a'.repeat(64),
  requestedModel: 'AUTO' as const,
})

const REASON = 'character_consistency: 顔の造作が参照と違う'

describe('CreateGenerationJobInput の系譜', () => {
  it('通常の生成では系譜を省略でき、両方 null になる', () => {
    const parsed = CreateGenerationJobInput.parse(baseInput())

    expect(parsed.parentTakeId).toBeNull()
    expect(parsed.regenerationReason).toBeNull()
  })

  it('再生成では親と理由を対で受け取る', () => {
    const parentTakeId = newId(TakeId)

    const parsed = CreateGenerationJobInput.parse({
      ...baseInput(),
      parentTakeId,
      regenerationReason: REASON,
    })

    expect(parsed.parentTakeId).toBe(parentTakeId)
    expect(parsed.regenerationReason).toBe(REASON)
  })

  it('親だけ渡して理由を忘れたら弾く（系譜の積み忘れ）', () => {
    expect(() =>
      CreateGenerationJobInput.parse({ ...baseInput(), parentTakeId: newId(TakeId) }),
    ).toThrow(/regenerationReason/)
  })

  it('空の理由・長すぎる理由を弾く', () => {
    const parentTakeId = newId(TakeId)

    expect(() =>
      CreateGenerationJobInput.parse({ ...baseInput(), parentTakeId, regenerationReason: '' }),
    ).toThrow()

    expect(() =>
      CreateGenerationJobInput.parse({
        ...baseInput(),
        parentTakeId,
        regenerationReason: 'x'.repeat(MAX_REGENERATION_REASON_LENGTH + 1),
      }),
    ).toThrow()
  })

  it('理由だけを渡す形は許す（親を消したあとと同じ形）', () => {
    const parsed = CreateGenerationJobInput.parse({
      ...baseInput(),
      regenerationReason: REASON,
    })

    expect(parsed.parentTakeId).toBeNull()
    expect(parsed.regenerationReason).toBe(REASON)
  })
})

describe('UpdateGenerationJobPatch', () => {
  it('系譜は更新対象に含まれない（後付けできない）', () => {
    /**
     * 系譜を進行中に書き換えられると、どの時点の値が Take に載ったのか分からなくなる。
     * 作成時に決めて、以後動かさない。
     */
    const parsed = UpdateGenerationJobPatch.parse({
      status: 'running',
      parentTakeId: newId(TakeId),
      regenerationReason: REASON,
    })

    expect(parsed).not.toHaveProperty('parentTakeId')
    expect(parsed).not.toHaveProperty('regenerationReason')
  })
})
