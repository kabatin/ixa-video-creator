import { z } from 'zod'
import { MediaAssetId, ProjectId, SfxJobId, TimelineClipId } from '../common/ids.js'
import { Seconds } from '../common/time.js'

/**
 * 効果音を作るジョブ（ADR-0052）。worker のキュー `sfx` で 1 つずつ動かす（手元の GPU を使う）。
 *
 * 1 つのジョブは 1 つの**きっかけ（cue）**から `count` 本の音を作る。できた音はそれぞれ素材になり、
 * **1 本目だけ**をタイムラインの効果音の段（`SFX`）に置く。残りは差し替えの候補として素材に残す。
 * 文章から作るモデルは映像を見ないので、鳴らす時刻は ixa の側（人かエージェント）が決める。
 */

/** 効果音の長さ（秒）。sfx-api の契約と同じ。 */
export const SFX_DURATION_MIN_SEC = 0.5
export const SFX_DURATION_MAX_SEC = 10
/** 説明（英語）の上限。sfx-api の契約と同じ。 */
export const SFX_PROMPT_MAX_LENGTH = 500
/** 1 つのきっかけで作る本数。 */
export const SFX_COUNT_MAX = 4
/** 音量。タイムラインのクリップと同じ範囲（0〜2）。 */
export const SFX_VOLUME_MAX = 2
export const SFX_DEFAULT_VOLUME = 0.8
/** 置いたクリップの終わりのフェード（秒）。音の切れ目でプツッと鳴らさない。 */
export const SFX_CLIP_FADE_OUT_SEC = 0.05

/**
 * 英語で書いたか。モデルは英語しか読まないので、日本語の説明は黙って意味の無い音になる。
 * 印字できる ASCII だけを受ける（改行・タブは空白に寄せてから見る）。
 */
const isEnglishText = (text: string): boolean => /^[\x20-\x7E]*$/.test(text.replace(/\s/g, ' '))

export const SfxPrompt = z
  .string()
  .trim()
  .min(1, '効果音の説明を入れてください')
  .max(SFX_PROMPT_MAX_LENGTH, `効果音の説明は ${String(SFX_PROMPT_MAX_LENGTH)} 文字までです`)
  .refine(isEnglishText, '効果音の説明は英語で書いてください（AI は英語しか読みません）')

/** きっかけ。どこで（時刻）・どれだけ（長さ）・何の音を（説明）・どの大きさで（音量）。 */
export const SfxCue = z.object({
  startSec: Seconds,
  durationSec: z
    .number()
    .finite()
    .min(SFX_DURATION_MIN_SEC, `効果音の長さは ${String(SFX_DURATION_MIN_SEC)}〜${String(SFX_DURATION_MAX_SEC)} 秒です`)
    .max(SFX_DURATION_MAX_SEC, `効果音の長さは ${String(SFX_DURATION_MIN_SEC)}〜${String(SFX_DURATION_MAX_SEC)} 秒です`),
  prompt: SfxPrompt,
  volume: z.number().finite().min(0).max(SFX_VOLUME_MAX).default(SFX_DEFAULT_VOLUME),
})
export type SfxCue = z.infer<typeof SfxCue>
export type SfxCueInput = z.input<typeof SfxCue>

export const SfxJobSpec = z.object({
  cue: SfxCue,
  count: z.number().int().min(1).max(SFX_COUNT_MAX),
  /** 同じ音を作り直すための種。省略は毎回違う音。 */
  seed: z.number().int().nonnegative().nullable(),
})
export type SfxJobSpec = z.infer<typeof SfxJobSpec>

export const SfxJobStatus = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled'])
export type SfxJobStatus = z.infer<typeof SfxJobStatus>

export const SfxJobError = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
})
export type SfxJobError = z.infer<typeof SfxJobError>

export const SfxJob = z.object({
  id: SfxJobId,
  projectId: ProjectId,
  /** 使う AI（効果音の AI）。 */
  tool: z.string().min(1),
  model: z.string().nullable(),
  spec: SfxJobSpec,
  status: SfxJobStatus,
  error: SfxJobError.nullable(),
  /** 調べるための記録（生成先のジョブ・かかった時間）。鍵と URL は入れない。 */
  providerRecord: z.record(z.unknown()).nullable(),
  /** できた音の素材（番号順）。成功するまで空。 */
  mediaAssetIds: z.array(MediaAssetId),
  /** 効果音の段に置いたクリップ（1 本目）。置くまでは null。 */
  timelineClipId: TimelineClipId.nullable(),
  queuedAt: z.date(),
  startedAt: z.date().nullable(),
  finishedAt: z.date().nullable(),
})
export type SfxJob = z.infer<typeof SfxJob>

/** 終わったジョブか（もう状態が変わらない）。 */
export const isSfxJobFinished = (status: SfxJobStatus): boolean =>
  status === 'succeeded' || status === 'failed' || status === 'cancelled'

/**
 * できた音をクリップにするときの中身。**長さは実際の音の長さ**（頼んだ長さと少し違うことがある）。
 * 実際の長さが取れなければ頼んだ長さで置く。
 */
export const sfxClipPlacement = (
  cue: SfxCue,
  actualDurationSec: number | null,
): { readonly startSec: number; readonly durationSec: number; readonly volume: number; readonly fadeOutSec: number } => {
  const durationSec =
    actualDurationSec !== null && Number.isFinite(actualDurationSec) && actualDurationSec > 0
      ? actualDurationSec
      : cue.durationSec
  return {
    startSec: cue.startSec,
    durationSec,
    volume: cue.volume,
    fadeOutSec: Math.min(SFX_CLIP_FADE_OUT_SEC, durationSec / 2),
  }
}
