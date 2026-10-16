import { AI_TOOLS, type AiToolId } from '@ixa/domain'

/**
 * 曲の AI で作れるか（ADR-0048）。作れるなら記す AI とモデル、作れないなら画面に出す理由。
 * 理由に設定の名前（環境変数）や実装の名前を入れない。
 */
export type MusicModelChoice =
  | { readonly state: 'ready'; readonly tool: AiToolId; readonly model: string }
  | { readonly state: 'unavailable'; readonly reason: string }

export const NO_MUSIC_AI_MESSAGE = '曲を作る AI が選ばれていません。「使う AI」で曲の AI を選んでください。'

/**
 * 曲の AI ごとのモデル。**null はこの環境で有効にしていない**（`.env` の一覧に無い）。
 * 口の無い AI は入れない。
 */
export type MusicModels = Partial<Record<AiToolId, string | null>>

/** 選んでいる曲の AI から、作れるかを決める。お試しは曲を作らない。 */
export const chooseMusicModel = (tool: AiToolId, models: MusicModels): MusicModelChoice => {
  const model = models[tool]
  if (tool === 'stub' || model === undefined) return { state: 'unavailable', reason: NO_MUSIC_AI_MESSAGE }
  if (model === null) {
    return {
      state: 'unavailable',
      reason: `${AI_TOOLS[tool].label} はこの環境で有効になっていません。「使う AI」で曲の AI を選び直してください。`,
    }
  }
  return { state: 'ready', tool, model }
}
