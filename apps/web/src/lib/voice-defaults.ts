import { VoiceToolId } from '@ixa/domain'
import type { WireVoiceOptions } from '@/lib/narration-api'

/** 声の AI の画面の名前（ADR-0038）。内部の名前（macos_say など）は画面に出さない。 */
export const VOICE_TOOL_LABELS: Readonly<Record<VoiceToolId, string>> = Object.freeze({
  stub: 'お試しの声',
  macos_say: 'Mac の声',
  gemini_api: 'Gemini',
  elevenlabs: 'ElevenLabs',
})

const STUB = Object.freeze({ tool: 'stub' as const, voiceName: 'stub', model: null })

/**
 * 声を名前だけで作るときの AI・声の種類・モデル。「使う AI」の声の AI と、その AI の一覧の最初の声。
 * 声に使えない AI が選ばれている・一覧が取れない・声が 0 件なら、お試しの声にする（作れないより、作って直せる方がよい）。
 */
export const newVoiceDefaults = (
  chosenTool: string,
  options: WireVoiceOptions | null,
): { readonly tool: VoiceToolId; readonly voiceName: string; readonly model: string | null } => {
  const tool = VoiceToolId.safeParse(chosenTool)
  const voice = options?.voices[0]
  if (!tool.success || voice === undefined) return STUB
  return { tool: tool.data, voiceName: voice.id, model: options?.models[0]?.id ?? null }
}
