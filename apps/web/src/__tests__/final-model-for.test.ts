import { describe, expect, it } from 'vitest'
import { finalModelFor } from '@/lib/generation-options'
import type { WireVideoModel } from '@/lib/models-api'

/**
 * 「本番で作り直す」が使うモデルの探し方（ADR-0042）。
 * **モデル ID を画面に書き写さない。** 一覧（`GET /models`）が唯一の正で、
 * 同じ Provider の段が `final` のものを引く。
 */

const aModel = (id: string, providerId: string, qualityTier: WireVideoModel['qualityTier']): WireVideoModel => ({
  id,
  providerId,
  label: id,
  fps: [24],
  resolutions: [{ width: 1920, height: 1080 }],
  aspectRatios: ['16:9'],
  durations: { mode: 'enum', values: [2.333] },
  maxReferenceImages: 1,
  costPerSecondUsd: 0,
  audioGeneration: false,
  requiresStartFrame: false,
  routable: false,
  qualityTier,
})

const DRAFT = aModel('vpipe/h3-draft', 'vpipe', 'draft')
const STANDARD = aModel('vpipe/h3', 'vpipe', 'standard')
const FINAL = aModel('vpipe/h3-final', 'vpipe', 'final')
const FAL = aModel('fal/seedance', 'fal', null)

describe('finalModelFor', () => {
  it('同じ Provider の本番の段を返す', () => {
    expect(finalModelFor([DRAFT, STANDARD, FINAL, FAL], DRAFT.id)?.id).toBe(FINAL.id)
  })

  /** 本番の段がまだ登録されていない環境（手元のサーバが古い・無効）では出さない。 */
  it('本番の段が無ければ null', () => {
    expect(finalModelFor([DRAFT, STANDARD], DRAFT.id)).toBeNull()
  })

  /** **別の Provider の本番を混ぜない。** fal の Take を H3 の本番で作り直すのは別物。 */
  it('ほかの Provider の本番は返さない', () => {
    expect(finalModelFor([FAL, FINAL], FAL.id)).toBeNull()
  })

  it('一覧が読めていなければ null', () => {
    expect(finalModelFor(null, DRAFT.id)).toBeNull()
  })

  it('その Take のモデルが一覧に無ければ null（消えたモデル）', () => {
    expect(finalModelFor([DRAFT, FINAL], 'vpipe/removed')).toBeNull()
  })

  it('本番の Take からも本番を引ける（作り直しを重ねられる）', () => {
    expect(finalModelFor([DRAFT, FINAL], FINAL.id)?.id).toBe(FINAL.id)
  })
})
