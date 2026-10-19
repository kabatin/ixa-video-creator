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

/**
 * きっかけの時刻の上限（秒）。作品の尺はこれより短い（1 時間）。桁違いの値は置き間違いなので弾く。
 * 作品の尺そのものとの照合は、尺が後から変わるのでしない。
 */
export const SFX_START_MAX_SEC = 60 * 60
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

/** 入れたくない音（英語）。MOSS が使う。Stable Audio は受けるが既定では使わない（ADR-0052 §1）。 */
export const SfxNegativePrompt = z
  .string()
  .trim()
  .min(1, '入れたくない音の説明が空です（要らなければ省いてください）')
  .max(SFX_PROMPT_MAX_LENGTH, `入れたくない音の説明は ${String(SFX_PROMPT_MAX_LENGTH)} 文字までです`)
  .refine(isEnglishText, '入れたくない音の説明は英語で書いてください（AI は英語しか読みません）')

/**
 * 音の一番大きいところで合わせる印（ADR-0054 追記）。付いたきっかけの `startSec` は**山を鳴らしたい時刻**で、
 * 置くときは「時刻 − 鳴り始めから山までの秒」へ寄せる（`sfxClipPlacement`）。`notBeforeSec`（Shot の始まり）より前には寄せない。
 * 動きの出来事のうち、瞬間と通り過ぎに付ける（続く音・環境音は鳴り始めで置く）。
 */
export const SfxCueAlign = z.object({ to: z.literal('peak'), notBeforeSec: Seconds })
export type SfxCueAlign = z.infer<typeof SfxCueAlign>

/** きっかけ。どこで（時刻）・どれだけ（長さ）・何の音を（説明）・どの大きさで（音量）。 */
export const SfxCue = z.object({
  startSec: Seconds.max(SFX_START_MAX_SEC, `効果音の時刻は ${String(SFX_START_MAX_SEC)} 秒までです`),
  durationSec: z
    .number()
    .finite()
    .min(SFX_DURATION_MIN_SEC, `効果音の長さは ${String(SFX_DURATION_MIN_SEC)}〜${String(SFX_DURATION_MAX_SEC)} 秒です`)
    .max(SFX_DURATION_MAX_SEC, `効果音の長さは ${String(SFX_DURATION_MIN_SEC)}〜${String(SFX_DURATION_MAX_SEC)} 秒です`),
  prompt: SfxPrompt,
  negativePrompt: SfxNegativePrompt.optional(),
  volume: z.number().finite().min(0).max(SFX_VOLUME_MAX).default(SFX_DEFAULT_VOLUME),
  align: SfxCueAlign.optional(),
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

/**
 * 1 回の頼みの i 番目のきっかけの種。**きっかけごとに違う種にする**（同じ種・説明・長さだと Stable Audio は
 * ビット一致の同じ音を返すので、2 つのフラッシュに同じ音が鳴る）。サーバは 1 つのきっかけの j 本目に
 * seed + 2j を使うので、きっかけの間は 2 × 本数 ずつ空けて重ねない。種を指定しなければ null（毎回違う音）。
 */
export const sfxCueSeed = (seed: number | null, cueIndex: number, count: number): number | null =>
  seed === null ? null : seed + cueIndex * 2 * count

/** できた音の種を記録（`providerRecord`）に入れる鍵。素材（`mediaAssetIds`）と同じ順。 */
export const SFX_SEEDS_USED_KEY = 'seedsUsed'

const SeedsUsed = z.array(z.number().int().nonnegative().nullable())

/**
 * できた音 1 本ずつの種（素材と同じ順）。この種を本数 1 で送ると同じ音が返る。
 * 記録に無い・形が違う・素材と数が合わないときは、分からないとして null を並べる（黙って別の種を出さない）。
 */
export const sfxSeedsUsedOf = (job: Pick<SfxJob, 'providerRecord' | 'mediaAssetIds'>): readonly (number | null)[] => {
  const parsed = SeedsUsed.safeParse(job.providerRecord?.[SFX_SEEDS_USED_KEY])
  return parsed.success && parsed.data.length === job.mediaAssetIds.length
    ? parsed.data
    : job.mediaAssetIds.map(() => null)
}

/** 終わったジョブか（もう状態が変わらない）。 */
export const isSfxJobFinished = (status: SfxJobStatus): boolean =>
  status === 'succeeded' || status === 'failed' || status === 'cancelled'

/** できた音の、鳴り始めから一番大きいところまでの秒を記録（`providerRecord`）に入れる鍵。素材と同じ順（ADR-0054 追記）。 */
export const SFX_PEAK_OFFSETS_KEY = 'peakOffsetsSec'

const PeakOffsets = z.array(Seconds.nullable())

/** できた音 1 本ずつの山までの秒（素材と同じ順）。記録に無い・形が違う・数が合わないときは null を並べる。 */
export const sfxPeakOffsetsOf = (job: Pick<SfxJob, 'providerRecord' | 'mediaAssetIds'>): readonly (number | null)[] => {
  const parsed = PeakOffsets.safeParse(job.providerRecord?.[SFX_PEAK_OFFSETS_KEY])
  return parsed.success && parsed.data.length === job.mediaAssetIds.length
    ? parsed.data
    : job.mediaAssetIds.map(() => null)
}

/**
 * 置く時刻。**山で合わせる印があり、山の秒が測れていれば**「時刻 − 山の秒」へ寄せ、Shot の始まりと 0 秒で切る。
 * それ以外は時刻のまま（画面と MCP のどちらから頼んでも、この 1 か所で決まる）。
 */
export const sfxClipStartSec = (cue: SfxCue, peakOffsetSec: number | null): number => {
  if (cue.align === undefined || peakOffsetSec === null || !Number.isFinite(peakOffsetSec) || peakOffsetSec < 0) {
    return cue.startSec
  }
  return Math.max(0, cue.align.notBeforeSec, cue.startSec - peakOffsetSec)
}

/**
 * できた音をクリップにするときの中身。**長さは実際の音の長さ**（頼んだ長さと少し違うことがある）。
 * 実際の長さが取れなければ頼んだ長さで置く。時刻は `sfxClipStartSec`（山で合わせる印があれば寄せる）。
 */
export const sfxClipPlacement = (
  cue: SfxCue,
  actualDurationSec: number | null,
  peakOffsetSec: number | null = null,
): { readonly startSec: number; readonly durationSec: number; readonly volume: number; readonly fadeOutSec: number } => {
  const durationSec =
    actualDurationSec !== null && Number.isFinite(actualDurationSec) && actualDurationSec > 0
      ? actualDurationSec
      : cue.durationSec
  return {
    startSec: sfxClipStartSec(cue, peakOffsetSec),
    durationSec,
    volume: cue.volume,
    fadeOutSec: Math.min(SFX_CLIP_FADE_OUT_SEC, durationSec / 2),
  }
}
