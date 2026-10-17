import { SFX_DURATION_MAX_SEC, SFX_DURATION_MIN_SEC, type SfxCue } from './sfx-job.js'

/**
 * 効果音のきっかけの案（ADR-0052 §3）。**純粋な関数。** タイムラインのエフェクトとトランジションから、
 * どこで何が鳴るとよいかを出す。Shot の中身に合わせた音（エンジン・雨）は見ない（人かエージェントが足す）。
 *
 * 入力は書き出しの文書（`TimelineDocument`）でも DB のクリップでも渡せるよう、使う欄だけの形にしてある。
 */

export type SfxSuggestionInput = {
  readonly video1: readonly { readonly shotId: string; readonly startSec: number }[]
  readonly transitions: readonly {
    readonly fromShotId: string
    readonly toShotId: string
    readonly type: string
    readonly durationSec: number
  }[]
  readonly clips: readonly {
    readonly track: string
    readonly startSec: number
    readonly durationSec: number
    readonly content: {
      readonly type: string
      readonly templateKey?: string
      readonly params?: Readonly<Record<string, unknown>>
    }
  }[]
}

/** どの種類の音か。近い時刻に同じ種類が重なったら 1 つにまとめる。 */
export type SfxSoundKind = 'impact' | 'whoosh' | 'boom' | 'pass_by' | 'thud'

export type SfxCueSuggestion = {
  readonly cue: SfxCue
  readonly kind: SfxSoundKind
  /** なぜここか（画面とエージェントにそのまま見せる）。 */
  readonly reason: string
}

type SoundRecipe = { readonly prompt: string; readonly durationSec: number; readonly volume: number }

/** 種類ごとの説明（英語。モデルは英語しか読まない）と長さ・音量。 */
const RECIPES: Readonly<Record<SfxSoundKind, SoundRecipe>> = Object.freeze({
  impact: { prompt: 'cinematic impact hit, punchy low-end thump, short and tight', durationSec: 1, volume: 0.8 },
  whoosh: { prompt: 'fast whoosh swish, whip pan transition, airy', durationSec: 0.8, volume: 0.7 },
  boom: { prompt: 'deep cinematic boom, sub bass hit with a long dark tail', durationSec: 2.5, volume: 0.9 },
  pass_by: { prompt: 'fast wind rush whoosh passing by, speed', durationSec: 1, volume: 0.6 },
  thud: { prompt: 'heavy dull thud impact, low rumble', durationSec: 0.8, volume: 0.8 },
})

/** エフェクトの型 → 音の種類と理由。ここに無い型（光漏れ・フィルム焼け・グリッチ）は案を出さない。 */
const EFFECT_SOUNDS: Readonly<Record<string, { readonly kind: SfxSoundKind; readonly reason: string }>> = Object.freeze({
  flash: { kind: 'impact', reason: 'フラッシュに合わせた衝撃音' },
  zoom_punch: { kind: 'impact', reason: '寄りのパンチに合わせた衝撃音' },
  title_card: { kind: 'boom', reason: 'タイトルカードに合わせた低い衝撃音' },
  speed_lines: { kind: 'pass_by', reason: 'スピード線に合わせた走り抜ける風切り音' },
  shake: { kind: 'thud', reason: '揺れに合わせた鈍い衝撃音' },
})

/** 同じ種類の音をまとめる近さ（秒）。フラッシュと寄りのパンチを同じ拍に置いても衝撃音は 1 つ。 */
export const SFX_SUGGESTION_MERGE_WINDOW_SEC = 0.15

const clampDuration = (sec: number): number =>
  Math.min(SFX_DURATION_MAX_SEC, Math.max(SFX_DURATION_MIN_SEC, sec))

const round3 = (sec: number): number => Math.round(sec * 1000) / 1000

const suggestion = (
  kind: SfxSoundKind,
  startSec: number,
  durationSec: number,
  reason: string,
): SfxCueSuggestion => {
  const recipe = RECIPES[kind]
  return {
    kind,
    reason,
    cue: {
      startSec: round3(Math.max(0, startSec)),
      durationSec: round3(clampDuration(durationSec)),
      prompt: recipe.prompt,
      volume: recipe.volume,
    },
  }
}

const numberParam = (params: Readonly<Record<string, unknown>> | undefined, key: string): number => {
  const value = params?.[key]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

const fromEffects = (clips: SfxSuggestionInput['clips']): readonly SfxCueSuggestion[] =>
  clips.flatMap((clip) => {
    if (clip.track !== 'VFX' || clip.content.type !== 'motion_graphics') return []
    const sound = EFFECT_SOUNDS[clip.content.templateKey ?? '']
    if (sound === undefined) return []
    const recipe = RECIPES[sound.kind]
    // 寄りのパンチは寄りきる時刻で鳴らす。スピード線はクリップの長さだけ風を流す。
    const startSec =
      clip.content.templateKey === 'zoom_punch'
        ? clip.startSec + Math.min(numberParam(clip.content.params, 'peakAtSec'), clip.durationSec)
        : clip.startSec
    const durationSec = sound.kind === 'pass_by' ? clip.durationSec : recipe.durationSec
    return [suggestion(sound.kind, startSec, durationSec, sound.reason)]
  })

const fromTransitions = (input: SfxSuggestionInput): readonly SfxCueSuggestion[] =>
  input.transitions.flatMap((transition) => {
    if (transition.type !== 'whip_pan') return []
    const to = input.video1.find((segment) => segment.shotId === transition.toShotId)
    if (to === undefined) return []
    // 境目をまたいで鳴らす（風切りの山を境目に合わせる）。
    const durationSec = clampDuration(Math.max(RECIPES.whoosh.durationSec, transition.durationSec + 0.3))
    return [suggestion('whoosh', to.startSec - durationSec / 2, durationSec, 'ウィップパンの境目に合わせた風切り音')]
  })

/** 時刻順に並べ、近い時刻の同じ種類を 1 つにまとめる（先に出た方を残す）。 */
const mergeNearby = (suggestions: readonly SfxCueSuggestion[]): readonly SfxCueSuggestion[] =>
  [...suggestions]
    .sort((a, b) => a.cue.startSec - b.cue.startSec)
    .reduce<readonly SfxCueSuggestion[]>((kept, next) => {
      const duplicate = kept.some(
        (existing) =>
          existing.kind === next.kind &&
          Math.abs(existing.cue.startSec - next.cue.startSec) <= SFX_SUGGESTION_MERGE_WINDOW_SEC,
      )
      return duplicate ? kept : [...kept, next]
    }, [])

/** タイムラインのエフェクトとトランジションから、効果音のきっかけの案を時刻順に出す。 */
export const suggestSfxCues = (input: SfxSuggestionInput): readonly SfxCueSuggestion[] =>
  mergeNearby([...fromEffects(input.clips), ...fromTransitions(input)])
