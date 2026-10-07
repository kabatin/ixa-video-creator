import { newId, ProjectId as ProjectIdSchema, TakeId as TakeIdSchema } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { resolveLineage } from '../routes/shots.js'
import { createInMemoryTakeRepository, aShot, aTake } from '@ixa/generation/testing'

const PROJECT_ID = newId(ProjectIdSchema)

/**
 * 作り直しの系譜（ADR-0042 の「本番で作り直す」）。
 *
 * **Take は作る瞬間にしか親を持てない**（作成後に `parent_take_id` を UPDATE できない。
 * `apps/worker/src/generation/lineage.ts`）。列も worker の処理も前からあったが、
 * **書く側がここまで無かった**ので、ここが最初の利用者になる。
 */

const aHash = (n: number): string => String(n).repeat(64).slice(0, 64)

const withParent = async () => {
  const shot = aShot(PROJECT_ID, { code: 'CUT-01' })
  const other = aShot(PROJECT_ID, { code: 'CUT-02' })
  const parent = aTake(shot, aHash(1), { index: 1 })
  const foreign = aTake(other, aHash(2), { index: 1 })
  const takes = createInMemoryTakeRepository([parent, foreign])
  return { shot, parent, foreign, deps: { takes } }
}

describe('resolveLineage', () => {
  it('どちらも渡さなければ、系譜なしで通す（通常の生成）', async () => {
    const { shot, deps } = await withParent()

    expect(await resolveLineage(deps, shot, undefined, undefined)).toEqual({ ok: true, value: null })
  })

  it('親と理由が揃っていれば、そのまま行に積む形で返す', async () => {
    const { shot, parent, deps } = await withParent()

    expect(await resolveLineage(deps, shot, parent.id, '本番で作り直す')).toEqual({
      ok: true,
      value: { parentTakeId: parent.id, regenerationReason: '本番で作り直す' },
    })
  })

  /** 親だけでは系譜にならない（domain の `lineagePairViolation` と同じ規則）。 */
  it('理由が無ければ断る', async () => {
    const { shot, parent, deps } = await withParent()

    const result = await resolveLineage(deps, shot, parent.id, undefined)

    expect(result.ok).toBe(false)
    expect(result.ok === false ? Object.keys(result.fields) : []).toEqual(['regenerationReason'])
  })

  it('理由だけでも断る（元の Take が分からない）', async () => {
    const { shot, deps } = await withParent()

    const result = await resolveLineage(deps, shot, undefined, '本番で作り直す')

    expect(result.ok).toBe(false)
    expect(result.ok === false ? Object.keys(result.fields) : []).toEqual(['parentTakeId'])
  })

  /** **別の Shot の Take を親にしない。** 系譜が Shot をまたぐと、何の作り直しか分からなくなる。 */
  it('ほかの Shot の Take は親にできない', async () => {
    const { shot, foreign, deps } = await withParent()

    const result = await resolveLineage(deps, shot, foreign.id, '本番で作り直す')

    expect(result.ok).toBe(false)
    expect(result.ok === false ? result.fields.parentTakeId?.[0] : '').toContain('この Shot に属する')
  })

  it('いない Take は親にできない', async () => {
    const { shot, deps } = await withParent()

    expect((await resolveLineage(deps, shot, newId(TakeIdSchema), '本番で作り直す')).ok).toBe(false)
  })

  /** 作り直しの元を「消し」ていても、記録としての系譜は正しい（Take は消えない）。 */
  it('見えなくした Take も親にできる', async () => {
    const { shot, parent, deps } = await withParent()
    await deps.takes.hide(parent.id, new Date())

    expect((await resolveLineage(deps, shot, parent.id, '本番で作り直す')).ok).toBe(true)
  })
})
