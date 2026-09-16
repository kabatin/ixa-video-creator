import type { CreateReviewFindingInput, Seconds, Severity, Shot } from '@ixa/domain'
import type {
  BrandColorRequirement,
  DeterministicReviewer,
  FrameSample,
  ReviewMeasurements,
} from './port.js'

/**
 * brand レビュア（ADR-0005 Stage 1 / ARCHITECTURE.md §12）。
 * 抽出フレームの色占有率が、要求された範囲に収まっているかを判定する。
 *
 * **純粋関数。** IO も時計も乱数も使わない。
 * ブランド色の要求が無いときは判定対象が無いので、指摘を返さずに抜ける。
 */

/**
 * 「その色が画面に無い」とみなす占有率の上限。
 * 1080p の 0.1% は約 2,000px。クロマサブサンプリングによる輪郭のにじみだけでも
 * この程度は出るため、これ以下は存在しないものとして扱う。
 */
export const BRAND_COLOR_ABSENT_RATIO = 0.001

const percent = (ratio: number): string => `${(ratio * 100).toFixed(2)}%`

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

type FindingDraft = {
  readonly severity: Severity
  readonly score: number
  readonly message: string
  readonly frameSec: Seconds | null
  readonly suggestedPromptDelta: string | null
}

const finding = (draft: FindingDraft): CreateReviewFindingInput => ({
  reviewer: 'brand',
  severity: draft.severity,
  // 色の占有率は連続値なので、どれだけ要求に近いかを score に入れる（1 が要求どおり）。
  score: draft.score,
  message: draft.message,
  evidence: { frameSec: draft.frameSec, bbox: null, comparedAssetId: null },
  suggestedPromptDelta: draft.suggestedPromptDelta,
})

/**
 * 判定に使うフレーム。編集で使う区間 `[sourceInSec, sourceInSec + durationSec)` に限る。
 * のりしろ（ADR-0011）は観客が見ないので、そこにブランド色が無くても欠陥ではない。
 * 区間内のフレームが 1 枚も無い場合だけ、判定材料を失わないよう全フレームに戻す。
 */
const framesForJudgement = (
  frames: readonly FrameSample[],
  shot: Shot,
): readonly FrameSample[] => {
  const used = frames.filter(
    (frame) =>
      frame.atSec >= shot.sourceInSec && frame.atSec < shot.sourceInSec + shot.durationSec,
  )
  return used.length > 0 ? used : frames
}

/** 計測されなかった色は「写っていない」と解釈する。キーの欠落を 0 と区別しない。 */
const ratioOf = (frame: FrameSample, key: string): number => frame.colorRatios[key] ?? 0

const mean = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0) / values.length

/** 指摘箇所として出すフレーム。不足なら最も少ないフレーム、過多なら最も多いフレーム。 */
const extremeFrame = (
  frames: readonly FrameSample[],
  key: string,
  direction: 'lowest' | 'highest',
): FrameSample | undefined =>
  frames.reduce<FrameSample | undefined>((best, frame) => {
    if (best === undefined) return frame
    const isBetter =
      direction === 'lowest'
        ? ratioOf(frame, key) < ratioOf(best, key)
        : ratioOf(frame, key) > ratioOf(best, key)
    return isBetter ? frame : best
  }, undefined)

/**
 * 要求そのものが壊れている場合は握り潰さずに落とす。
 * 範囲外や逆転した要求を黙って判定すると、常に不合格を返す壊れたゲートになる。
 */
const assertValidRequirement = (requirement: BrandColorRequirement): void => {
  const { key, minRatio, maxRatio } = requirement
  const isRatio = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= 1
  if (!isRatio(minRatio) || !isRatio(maxRatio)) {
    throw new RangeError(
      `ブランド色 ${key} の要求は 0..1 の占有率である必要がある: ` +
        `minRatio ${String(minRatio)} / maxRatio ${String(maxRatio)}`,
    )
  }
  if (minRatio > maxRatio) {
    throw new RangeError(
      `ブランド色 ${key} の要求が矛盾している: ` +
        `minRatio ${String(minRatio)} > maxRatio ${String(maxRatio)}`,
    )
  }
}

const checkRequirement = (
  requirement: BrandColorRequirement,
  frames: readonly FrameSample[],
): readonly CreateReviewFindingInput[] => {
  assertValidRequirement(requirement)

  const { key, minRatio, maxRatio } = requirement
  const average = mean(frames.map((frame) => ratioOf(frame, key)))

  if (average < minRatio) {
    // 完全に写っていないのは明確な欠陥なので fail。足りないだけなら程度問題として warn。
    const absent = average <= BRAND_COLOR_ABSENT_RATIO
    return [
      finding({
        severity: absent ? 'fail' : 'warn',
        // average < minRatio かつ average >= 0 なので minRatio > 0 が確定する（0 除算は起きない）。
        score: clamp01(average / minRatio),
        message: absent
          ? `ブランド色 ${key} が画面に無い（要求 ${percent(minRatio)} 以上）`
          : `ブランド色 ${key} の占有率 ${percent(average)} が要求 ${percent(minRatio)} に足りない`,
        frameSec: extremeFrame(frames, key, 'lowest')?.atSec ?? null,
        /**
         * 再生成ループはこれをプロンプトへ足すだけでよい。
         * `spec-compiler` が `promptParts.colorPalette` を組む書式に合わせた断片を返す。
         */
        suggestedPromptDelta: `color palette: ${key}`,
      }),
    ]
  }

  if (average > maxRatio) {
    return [
      finding({
        severity: 'warn',
        // average > maxRatio >= 0 なので average > 0 が確定する（0 除算は起きない）。
        score: clamp01(maxRatio / average),
        message: `ブランド色 ${key} の占有率 ${percent(average)} が上限 ${percent(maxRatio)} を超えている`,
        frameSec: extremeFrame(frames, key, 'highest')?.atSec ?? null,
        /**
         * 「減らす」はプロンプトの追記で表現できない。無理に文を作ると再生成ループが
         * 意味の無い差分を積むので null を返し、人間かパラメータ側の判断に委ねる。
         */
        suggestedPromptDelta: null,
      }),
    ]
  }

  return []
}

export const brandReviewer: DeterministicReviewer = (
  measurements: ReviewMeasurements,
): readonly CreateReviewFindingInput[] => {
  const { brandColors, frames, shot } = measurements
  // 要求が無ければ判定するものが無い（skip）。
  if (brandColors.length === 0) return []
  // フレームが無いことは technical レビュアが fail として報告する。ここで二重に出さない。
  if (frames.length === 0) return []

  const judged = framesForJudgement(frames, shot)
  return brandColors.flatMap((requirement) => checkRequirement(requirement, judged))
}
