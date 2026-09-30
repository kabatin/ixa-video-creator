import { ModelId, ProviderId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { SpecCompilationError, type ModelCatalogPort } from '../build-generation.js'
import { catalogForVideoChoice, type ChoosableVideoModel } from '../video-choice.js'

/**
 * AUTO を「使う AI」で選んだ動画の AI の中に絞る（ADR-0032）。
 * **fal を .env で有効にしていても、無料の AI を選んだ人の AUTO が fal を選ばない**ことが目的。
 */

const model = (providerId: string, id: string, routable = true): ChoosableVideoModel => ({
  id: ModelId.parse(id),
  providerId: ProviderId.parse(providerId),
  routable,
  capabilities: {
    durations: { mode: 'range', min: 1, max: 10 },
    referenceImages: { max: 3, roles: ['subject'] },
  },
})

const MODELS = [
  model('stub', 'stub/veo-like'),
  model('fal', 'fal/seedance'),
  model('local', 'local/still-motion', false),
  model('vpipe', 'vpipe/minimax-h3-turbo-draft', false),
  model('vpipe', 'vpipe/minimax-h3-turbo', false),
]

const catalog: ModelCatalogPort<ChoosableVideoModel> = {
  allModels: () => MODELS,
  findModel: (id) => {
    const found = MODELS.find((candidate) => candidate.id === id)
    if (found === undefined) throw new Error(`no ${id}`)
    return found
  },
}

describe('catalogForVideoChoice', () => {
  it('AUTO の候補は選んだ AI のモデルだけ（有料の fal が混ざらない）', () => {
    const ids = catalogForVideoChoice(catalog, ProviderId.parse('stub'))
      .allModels()
      .map((m) => m.id)

    expect(ids).toEqual(['stub/veo-like'])
  })

  /** 人が選んだ AI なので、AUTO に選ばせない印（routable: false）でも候補にする。 */
  it('選んだ AI のモデルは、ふだん AUTO に出ないものでも候補にする', () => {
    const models = catalogForVideoChoice(catalog, ProviderId.parse('vpipe')).allModels()

    expect(models.map((m) => m.id)).toEqual([
      'vpipe/minimax-h3-turbo-draft',
      'vpipe/minimax-h3-turbo',
    ])
    expect(models.every((m) => m.routable)).toBe(true)
  })

  it('明示したモデルはそのまま引ける（選んだ AI の外でも）', () => {
    expect(
      catalogForVideoChoice(catalog, ProviderId.parse('stub')).findModel(
        ModelId.parse('fal/seedance'),
      ).id,
    ).toBe('fal/seedance')
  })

  it('選んだ AI がこの環境で有効でなければ、AUTO は理由を付けて止める', () => {
    const empty = catalogForVideoChoice(
      { ...catalog, allModels: () => [] },
      ProviderId.parse('vpipe'),
    )

    expect(() => empty.allModels()).toThrow(SpecCompilationError)
    expect(() => empty.allModels()).toThrow(/使う AI/)
  })
})
