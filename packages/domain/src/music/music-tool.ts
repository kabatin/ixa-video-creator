import type { z } from 'zod'
import { AI_TOOLS, AiToolId } from '../ai/ai-tools.js'
import {
  MUSIC_DURATION_MAX_SEC,
  MUSIC_DURATION_MIN_SEC,
  STABLE_AUDIO_MUSIC_DURATION_MAX_SEC,
  type MusicJobSpec,
} from './music-job.js'

/**
 * 曲の AI ごとの違い（ADR-0048 追記）。ACE-Step と MiniMax-Music3 は歌あり・歌なしの両方を作れるが、
 * Stable Audio 3 Medium は歌なしの BGM だけで、長さも 190 秒まで。
 * **規則はここ 1 か所**で、API の検査・画面の欄・説明が同じ値を読む。
 */

/** 曲を作れる AI。**足したら下の表（`LIMITS`）と、歌えるなら `MUSIC_VOCAL_FALLBACK_ORDER` にも足す**（テストが見張る）。 */
export const MusicAiToolId = AiToolId.extract(['ace_step', 'minimax_music3', 'stable_audio_medium_music'])
export type MusicAiToolId = z.infer<typeof MusicAiToolId>
export type MusicToolLimits = {
  /** 歌（歌詞・ボーカル）を作れるか。false なら歌なしだけ。 */
  readonly vocals: boolean
  readonly durationSec: { readonly min: number; readonly max: number }
}

const DEFAULT_LIMITS: MusicToolLimits = Object.freeze({
  vocals: true,
  durationSec: Object.freeze({ min: MUSIC_DURATION_MIN_SEC, max: MUSIC_DURATION_MAX_SEC }),
})

const LIMITS: Readonly<Record<MusicAiToolId, MusicToolLimits>> = Object.freeze({
  ace_step: DEFAULT_LIMITS,
  // 長さは上限（曲が早く終わることがある）。実際の長さは出来上がりの方を使う。
  minimax_music3: DEFAULT_LIMITS,
  stable_audio_medium_music: Object.freeze({
    vocals: false,
    durationSec: Object.freeze({ min: MUSIC_DURATION_MIN_SEC, max: STABLE_AUDIO_MUSIC_DURATION_MAX_SEC }),
  }),
})

export const musicToolLimits = (tool: AiToolId): MusicToolLimits => {
  const music = MusicAiToolId.safeParse(tool)
  return music.success ? LIMITS[music.data] : DEFAULT_LIMITS
}

type SpecForTool = Pick<MusicJobSpec, 'lyrics' | 'instrumental' | 'durationSec'>

/**
 * 歌ありでも歌詞が空なら歌なしにする。ace-step-api はどちらのエンジンも歌詞が空なら歌なしで作る
 * （`empty_means_instrumental`）ので、記録と振り分けもそれに揃える（歌ありと記したまま歌なしが届かない）。
 */
export const normalizeMusicSpec = <T extends SpecForTool>(spec: T): T =>
  !spec.instrumental && spec.lyrics.trim() === '' ? { ...spec, instrumental: true } : spec

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

/** 歌なしだけの AI に歌ありが来たときに回す先。速い方から（制作者 2026-10-19）。歌える AI はすべて入れる。 */
export const MUSIC_VOCAL_FALLBACK_ORDER: readonly MusicAiToolId[] = Object.freeze(['ace_step', 'minimax_music3'])

export type MusicToolDecision =
  | { readonly state: 'ready'; readonly tool: AiToolId; /** 選んだ AI ではなく歌える AI に回した。 */ readonly rerouted: boolean }
  | { readonly state: 'rejected'; readonly reason: string }

/**
 * どの曲の AI で作るか（頼み方は `normalizeMusicSpec` で揃えてから見る）。選んだ AI で作れればそのまま。
 * **歌なしだけの AI に歌ありが来たときだけ**、歌える AI を `MUSIC_VOCAL_FALLBACK_ORDER` の順に見て、
 * 使えて作れる最初のものへ回す。使える AI が無ければ選んだ AI の理由で、使えても作れなければ最初のものの理由で断る。
 * 歌なしの頼み（歌詞だけ付いている・長すぎる）は回さない（回しても歌なしの頼みは変わらない）。
 *
 * `canUse` はこの環境でその AI を使えるか（API は `.env` で有効か、画面は常に true として先に見せる）。
 */
export const decideMusicTool = (
  chosen: AiToolId,
  requested: SpecForTool,
  canUse: (tool: AiToolId) => boolean,
): MusicToolDecision => {
  const spec = normalizeMusicSpec(requested)
  const problem = musicSpecProblem(chosen, spec)
  if (problem === null) return { state: 'ready', tool: chosen, rerouted: false }
  if (musicToolLimits(chosen).vocals || spec.instrumental) return { state: 'rejected', reason: problem }
  const usable = MUSIC_VOCAL_FALLBACK_ORDER.filter((tool) => tool !== chosen && canUse(tool))
  const fit = usable.find((tool) => musicSpecProblem(tool, spec) === null)
  if (fit !== undefined) return { state: 'ready', tool: fit, rerouted: true }
  const first = usable[0]
  return { state: 'rejected', reason: first === undefined ? problem : (musicSpecProblem(first, spec) ?? problem) }
}
