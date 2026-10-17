import { AI_TOOLS, type AiToolId } from '@ixa/domain'

/**
 * 効果音の AI で作れるか（ADR-0052）。作れるなら記す AI とモデル、作れないなら画面に出す理由。
 * 理由に設定の名前（環境変数）や実装の名前を入れない。
 */
export type SfxModelChoice =
  | { readonly state: 'ready'; readonly tool: AiToolId; readonly model: string }
  | { readonly state: 'unavailable'; readonly reason: string }

export const NO_SFX_AI_MESSAGE = '効果音を作る AI が選ばれていません。「使う AI」で効果音の AI を選んでください。'

/**
 * 効果音の AI ごとのモデル。**null はこの環境で有効にしていない**（`.env` の一覧に無い）。
 * 口の無い AI は入れない。
 */
export type SfxModels = Partial<Record<AiToolId, string | null>>

/** 選んでいる効果音の AI から、作れるかを決める。お試しは効果音を作らない。 */
export const chooseSfxModel = (tool: AiToolId, models: SfxModels): SfxModelChoice => {
  const model = models[tool]
  if (tool === 'stub' || model === undefined) return { state: 'unavailable', reason: NO_SFX_AI_MESSAGE }
  if (model === null) {
    return {
      state: 'unavailable',
      reason: `${AI_TOOLS[tool].label} はこの環境で有効になっていません。「使う AI」で効果音の AI を選び直してください。`,
    }
  }
  return { state: 'ready', tool, model }
}
