import { computeSpecHash, quantizeDuration } from '@ixa/domain'
import { buildGeneration } from '@ixa/generation'
import { describe, expect, it } from 'vitest'
import { rebuildSpec } from '../spec.js'
import { aProject, aShot, contextWith, testModel } from './doubles.js'

/**
 * **api が組んだ仕様を、worker が行だけから再現できるか。**
 *
 * worker は投入時の仕様を受け取らない（キューは ID しか運ばない）。
 * `GenerationJob` の行に載っているものだけで組み直し、`specHash` が一致しなければ
 * `spec_drift` で止める。だから **行に積み忘れた項目は、必ず本番で落ちる**。
 *
 * 実際に 2 回落ちた。
 * - `corrections`（L-012）
 * - `seed`（2026-10-07。ADR-0042 の「本番で作り直す」。1 本目の投入が `spec_drift` で失敗）
 *
 * どちらも「行に積む」側と「組み直す」側を別々に直していて、**通しで見る検査が無かった**。
 * ここが通しで見る。仕様に効く項目を足したら、この検査に 1 行足すこと。
 */

/** 1 つのモデルだけを持つ目録と、呼ばれない router（モデルを明示するので要らない）。 */
const catalog = () => ({
  allModels: () => [testModel()],
  findModel: () => testModel(),
})
const router = () => ({
  /** モデルを明示するので選ばせない。呼ばれたら設計が変わった印なので落とす。 */
  selectModel: () => {
    throw new Error('モデルを明示しているので router は呼ばれない')
  },
  /** 仕様がモデルの宣言に収まっているか。この検査ではどれも収まっている。 */
  validateAgainstCapabilities: () => [],
})

describe('api が組んだ仕様と、worker の組み直しが一致する', () => {
  /** **同じ fixture で比べる。** 作り直すと id が変わり、別の理由でハッシュが動く。 */
  const model = testModel()
  const project = aProject()
  const shot = aShot(project)

  /** api 側（`buildGeneration`）と worker 側（`rebuildSpec`）を同じ材料で走らせて突き合わせる。 */
  const roundTrip = async (options: { corrections?: readonly string[]; seed?: number | null }) => {
    const context = contextWith()
    const built = await buildGeneration(
      { context, catalog: catalog(), router: router() },
      shot,
      project,
      model.id,
      {
        ...(options.corrections === undefined ? {} : { corrections: options.corrections }),
        ...(options.seed === undefined ? {} : { seed: options.seed }),
      },
    )
    const rebuilt = await rebuildSpec(
      context,
      shot,
      project,
      model,
      // **行に載るもの**だけを渡す（worker が持てる情報はこれだけ）。
      options.corrections ?? [],
      options.seed ?? null,
    )
    return { built, rebuilt }
  }

  it('何も添えないジョブ', async () => {
    const { built, rebuilt } = await roundTrip({})

    expect(rebuilt.specHash).toBe(built.specHash)
  })

  it('直しを添えたジョブ（L-012）', async () => {
    const { built, rebuilt } = await roundTrip({ corrections: ['顔を切らない'] })

    expect(rebuilt.specHash).toBe(built.specHash)
  })

  /** 「本番で作り直す」は同じシードで頼む。行に積まないとここで落ちる（2026-10-07 に落ちた）。 */
  it('シードを添えたジョブ（ADR-0042）', async () => {
    const { built, rebuilt } = await roundTrip({ seed: 917318685 })

    expect(rebuilt.specHash).toBe(built.specHash)
    expect(rebuilt.spec.seed).toBe(917318685)
  })

  it('0 のシード（0 と「任せる」を混ぜない）', async () => {
    const { built, rebuilt } = await roundTrip({ seed: 0 })

    expect(rebuilt.specHash).toBe(built.specHash)
    expect(rebuilt.spec.seed).toBe(0)
  })

  it('直しとシードの両方', async () => {
    const { built, rebuilt } = await roundTrip({ corrections: ['手を 5 本にしない'], seed: 42 })

    expect(rebuilt.specHash).toBe(built.specHash)
  })

  /** **違うものは違うと分かること。** 全部一致してしまう検査では、積み忘れを見つけられない。 */
  it('行のシードが違えば、ハッシュも違う（検査が効いていることの確認）', async () => {
    const context = contextWith()
    const built = await buildGeneration(
      { context, catalog: catalog(), router: router() },
      shot,
      project,
      model.id,
      { seed: 1 },
    )
    const rebuilt = await rebuildSpec(context, shot, project, model, [], null)

    expect(rebuilt.specHash).not.toBe(built.specHash)
    expect(await computeSpecHash(rebuilt.spec)).toBe(rebuilt.specHash)
    // 尺の切り上げは両側で同じ規則（ADR-0011）。
    expect(rebuilt.spec.durationSec).toBe(quantizeDuration(shot.durationSec, model.capabilities.durations))
  })
})
