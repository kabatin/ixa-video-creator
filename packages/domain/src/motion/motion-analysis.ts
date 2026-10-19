import { z } from 'zod'
import { TakeId, TakeMotionAnalysisId } from '../common/ids.js'
import { Seconds } from '../common/time.js'
import { SfxPrompt } from '../sfx/sfx-job.js'

/**
 * Take の動きの分析（ADR-0054）。**時刻はすべて Take の秒。** タイムラインの秒は読むときに Shot から直す
 * （使い始め・速さは後から変わるため）。
 *
 * 1 つの Take に何度も分析の行ができる（追記のみ）。いちばん新しい行が今の結果。
 */

/** 解析器の版。抜き方（12fps・64×36・灰色）・山の取り方・AI への頼み方を変えたら上げる。 */
export const MOTION_ANALYZER_VERSION = 'motion-v1'

/** 1 つの分析で持てる出来事の数。AI が暴走して何百も返したら置き間違いとして弾く。 */
export const MOTION_EVENTS_MAX = 80
/** 出来事の日本語の名前の上限（画面の印の札に出す）。 */
export const MOTION_EVENT_LABEL_MAX_LENGTH = 40

/**
 * 出来事の種類。
 * - `moment`: 瞬間（衝撃・着地・バックファイア）。山に寄せる
 * - `sustained`: 続く音（スキール・エンジン・水しぶき）
 * - `pass_by`: 通り過ぎ（風切り）
 * - `ambient`: 環境音（雑踏・風・波）
 */
export const MotionEventKind = z.enum(['moment', 'sustained', 'pass_by', 'ambient'])
export type MotionEventKind = z.infer<typeof MotionEventKind>

export const MotionEvent = z.object({
  kind: MotionEventKind,
  takeStartSec: Seconds,
  /** 音の長さの目安。瞬間でも鳴らす長さを持つ（余韻）。 */
  takeDurationSec: Seconds,
  /** 画面に出す名前（日本語）。「着地」「スキール」など。 */
  label: z.string().trim().min(1).max(MOTION_EVENT_LABEL_MAX_LENGTH),
  /** 効果音の AI に渡す指示（英語）。 */
  sfxPrompt: SfxPrompt,
  confidence: z.number().min(0).max(1),
})
export type MotionEvent = z.infer<typeof MotionEvent>

/** 動きの強さの山。`strength` はその Take の最も強い山を 1 とした相対値。 */
export const MotionOnset = z.object({
  atSec: Seconds,
  strength: z.number().min(0).max(1),
})
export type MotionOnset = z.infer<typeof MotionOnset>

export const MotionAnalysisStatus = z.enum(['succeeded', 'failed'])
export type MotionAnalysisStatus = z.infer<typeof MotionAnalysisStatus>

export const MotionAnalysis = z
  .object({
    id: TakeMotionAnalysisId,
    takeId: TakeId,
    analyzerVersion: z.string().min(1),
    status: MotionAnalysisStatus,
    /** 強さの列のコマの間隔（秒）。 */
    energyHopSec: z.number().finite().positive(),
    /** 隣のコマとの差の平均（0〜1）。i 番目は i × energyHopSec 秒。 */
    energy: z.array(z.number().min(0).max(1)),
    onsets: z.array(MotionOnset),
    events: z.array(MotionEvent).max(MOTION_EVENTS_MAX),
    /** AI（Claude）がコマを見て判断したか。false は山だけから作った案。 */
    visionUsed: z.boolean(),
    costUsd: z.number().finite().nonnegative(),
    /** 失敗の理由（画面に出せる日本語）。成功なら null。 */
    failureMessage: z.string().min(1).nullable(),
    createdAt: z.date(),
  })
  .refine((a) => (a.status === 'failed') === (a.failureMessage !== null), {
    message: '失敗の行だけが理由を持ちます',
    path: ['failureMessage'],
  })
export type MotionAnalysis = z.infer<typeof MotionAnalysis>

/** 行を 1 つ足すときの入力。id と createdAt はリポジトリが採番する。**追記のみ。** */
export type CreateMotionAnalysisInput = Omit<MotionAnalysis, 'id' | 'createdAt'>

/**
 * 出来事を Take の長さに収める（AI は Take の外の時刻を返すことがある）。
 * 外で始まるものは落とし、終わりがはみ出すものは Take の終わりで切る。時刻順に並べる。
 */
export const fitEventsToTake = (events: readonly MotionEvent[], takeDurationSec: number): readonly MotionEvent[] =>
  events
    .filter((event) => event.takeStartSec < takeDurationSec)
    .map((event) => ({
      ...event,
      takeDurationSec: Math.min(event.takeDurationSec, takeDurationSec - event.takeStartSec),
    }))
    .sort((a, b) => a.takeStartSec - b.takeStartSec)

/**
 * 分析を走らせる必要があるか。**同じ版で成功していれば作り直さない。**
 * ただし AI で見ていない結果は、AI で見られるようになったら作り直す（山だけの案を使い続けない）。
 */
export const needsMotionAnalysis = (
  latest: Pick<MotionAnalysis, 'analyzerVersion' | 'status' | 'visionUsed'> | null,
  options: { readonly visionAvailable: boolean; readonly analyzerVersion?: string },
): boolean => {
  if (latest === null || latest.status !== 'succeeded') return true
  if (latest.analyzerVersion !== (options.analyzerVersion ?? MOTION_ANALYZER_VERSION)) return true
  return !latest.visionUsed && options.visionAvailable
}
