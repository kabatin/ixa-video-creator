import { z } from 'zod'
import { ProjectId, TextStyleId, VoiceProfileId } from '../common/ids.js'

/**
 * 声（ADR-0038）。ナレーター・キャラクターの声を作品ごとに持つ。「声のイメージ」は自然な文で書く
 * （Gemini は読み方の指示として、ElevenLabs は調整の目安として使う。Mac の声は使わない）。
 *
 * 声の AI ごとに声の種類（`voiceName`）の意味が違う（Mac: Kyoko、Gemini: Kore、ElevenLabs: 声の ID）。
 * そのため AI を替えると別の声になる。
 */

/** 声に使える AI。廃止した `gemini_cli` は使わない（Gemini の声は HTTP の API）。 */
export const VoiceToolId = z.enum(['stub', 'macos_say', 'gemini_api', 'elevenlabs'])
export type VoiceToolId = z.infer<typeof VoiceToolId>

export const VOICE_NAME_MAX = 40
export const VOICE_STYLE_NOTE_MAX = 500
export const VOICE_SPEED_MIN = 0.5
export const VOICE_SPEED_MAX = 2

/** ElevenLabs の調整（0〜1）。ほかの AI では使わない。 */
export const VoiceTuning = z
  .object({
    stability: z.number().min(0).max(1).optional(),
    similarity: z.number().min(0).max(1).optional(),
    style: z.number().min(0).max(1).optional(),
  })
  .strict()
export type VoiceTuning = z.infer<typeof VoiceTuning>

const fields = {
  projectId: ProjectId,
  /** 画面での呼び名（例: ナレーター・戦子の声）。 */
  name: z.string().trim().min(1).max(VOICE_NAME_MAX),
  tool: VoiceToolId,
  /** 声の AI のモデル（例: gemini-3.8-flash-tts）。Mac の声・スタブは null。 */
  model: z.string().trim().min(1).max(100).nullable(),
  /** 声の種類（AI ごとの声の名前や ID）。 */
  voiceName: z.string().trim().min(1).max(100),
  /** 声のイメージ（自然な文）。 */
  styleNote: z.string().max(VOICE_STYLE_NOTE_MAX),
  speed: z.number().min(VOICE_SPEED_MIN).max(VOICE_SPEED_MAX),
  /** タイムラインでの音量（読み上げの中身には含めない）。 */
  volume: z.number().min(0).max(2),
  /** 言語（例: ja, en-US）。 */
  language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
  tuning: VoiceTuning,
  /** この声のテロップの見た目（無ければ「ナレーション」の見た目）。 */
  textStyleId: TextStyleId.nullable(),
}

export const VoiceProfile = z.object({
  id: VoiceProfileId,
  ...fields,
  createdAt: z.date(),
  updatedAt: z.date(),
})
export type VoiceProfile = z.infer<typeof VoiceProfile>

export const CreateVoiceProfileInput = z.object({
  ...fields,
  model: fields.model.default(null),
  styleNote: fields.styleNote.default(''),
  speed: fields.speed.default(1),
  volume: fields.volume.default(1),
  language: fields.language.default('ja'),
  tuning: fields.tuning.default({}),
  textStyleId: fields.textStyleId.default(null),
})
export type CreateVoiceProfileInput = z.input<typeof CreateVoiceProfileInput>

export const UpdateVoiceProfilePatch = z.object(fields).omit({ projectId: true }).partial()
export type UpdateVoiceProfilePatch = z.infer<typeof UpdateVoiceProfilePatch>
