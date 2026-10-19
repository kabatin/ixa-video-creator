import { AI_TOOLS, type AiToolId } from '../ai/ai-tools.js'
import {
  MUSIC_DURATION_MAX_SEC,
  MUSIC_DURATION_MIN_SEC,
  STABLE_AUDIO_MUSIC_DURATION_MAX_SEC,
  type MusicJobSpec,
} from './music-job.js'

/**
 * 曲の AI ごとの違い（ADR-0048 追記）。ACE-Step は歌えるが、Stable Audio 3 Medium は歌なしの BGM だけで、
 * 長さも 190 秒まで。**規則はここ 1 か所**で、API の検査・画面の欄・説明が同じ値を読む。
 */
export type MusicToolLimits = {
  /** 歌（歌詞・ボーカル）を作れるか。false なら歌なしだけ。 */
  readonly vocals: boolean
  readonly durationSec: { readonly min: number; readonly max: number }
}

const DEFAULT_LIMITS: MusicToolLimits = Object.freeze({
  vocals: true,
  durationSec: Object.freeze({ min: MUSIC_DURATION_MIN_SEC, max: MUSIC_DURATION_MAX_SEC }),
})

const LIMITS: Partial<Record<AiToolId, MusicToolLimits>> = Object.freeze({
  stable_audio_medium_music: Object.freeze({
    vocals: false,
    durationSec: Object.freeze({ min: MUSIC_DURATION_MIN_SEC, max: STABLE_AUDIO_MUSIC_DURATION_MAX_SEC }),
  }),
})

export const musicToolLimits = (tool: AiToolId): MusicToolLimits => LIMITS[tool] ?? DEFAULT_LIMITS

/**
 * 選んでいる曲の AI では作れない頼み方なら、その理由（画面にそのまま出す文）。作れるなら null。
 * **歌を黙って捨てない**（歌ありのまま歌なしで作ると、頼んだものと違う曲が届く）。
 */
export const musicSpecProblem = (
  tool: AiToolId,
  spec: Pick<MusicJobSpec, 'lyrics' | 'instrumental' | 'durationSec'>,
): string | null => {
  const limits = musicToolLimits(tool)
  const { label } = AI_TOOLS[tool]
  if (!limits.vocals && !spec.instrumental) {
    return `${label} は歌なしの曲だけを作ります。「歌なし」にするか、「使う AI」の「曲」で歌える AI を選んでください。`
  }
  if (!limits.vocals && spec.lyrics.trim() !== '') {
    return `${label} では歌詞は使えません。歌詞を空にするか、「使う AI」の「曲」で歌える AI を選んでください。`
  }
  const { min, max } = limits.durationSec
  if (spec.durationSec < min || spec.durationSec > max) {
    return `${label} で作れる長さは ${String(min)}〜${String(max)} 秒です。`
  }
  return null
}

/** 歌なしだけの AI に歌ありが来たときに回す先（制作者 2026-10-19）。 */
export const MUSIC_VOCAL_FALLBACK_TOOL: AiToolId = 'ace_step'

export type MusicToolDecision =
  | { readonly state: 'ready'; readonly tool: AiToolId; /** 選んだ AI ではなく歌える AI に回した。 */ readonly rerouted: boolean }
  | { readonly state: 'rejected'; readonly reason: string }

/**
 * どの曲の AI で作るか。選んだ AI で作れればそのまま。**歌なしだけの AI に歌ありが来たときだけ**、
 * 歌える AI（ACE-Step）が使えればそちらへ回す。使えなければ選んだ AI の理由で断る。
 * 歌なしの頼み（歌詞だけ付いている・長すぎる）は回さない（回しても歌なしの頼みは変わらない）。
 *
 * `canUse` はこの環境でその AI を使えるか（API は `.env` で有効か、画面は常に true として先に見せる）。
 */
export const decideMusicTool = (
  chosen: AiToolId,
  spec: Pick<MusicJobSpec, 'lyrics' | 'instrumental' | 'durationSec'>,
  canUse: (tool: AiToolId) => boolean,
): MusicToolDecision => {
  const problem = musicSpecProblem(chosen, spec)
  if (problem === null) return { state: 'ready', tool: chosen, rerouted: false }
  const reroutable = !musicToolLimits(chosen).vocals && !spec.instrumental && canUse(MUSIC_VOCAL_FALLBACK_TOOL)
  if (!reroutable) return { state: 'rejected', reason: problem }
  const fallbackProblem = musicSpecProblem(MUSIC_VOCAL_FALLBACK_TOOL, spec)
  return fallbackProblem === null
    ? { state: 'ready', tool: MUSIC_VOCAL_FALLBACK_TOOL, rerouted: true }
    : { state: 'rejected', reason: fallbackProblem }
}
