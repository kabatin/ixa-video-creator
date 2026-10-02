import { LLM_REVIEWERS, ReviewerType } from '@ixa/domain'
import type { Severity } from '@ixa/domain'
import { z } from 'zod'
import { UnsupportedReviewerError } from './errors.js'
import {
  VisionReviewRequest,
  type VisionReviewOutcome,
  type VisionReviewResult,
  type VisionReviewer,
} from './port.js'

/**
 * ローカルのスタブ vision レビュア（ADR-0005 / ADR-0014 のスタブ動画 Provider に倣う）。
 *
 * 一時的なモックではなく、**恒久的に維持する一級の実装**として扱う。目的は
 * 「再生成ループ（生成 → 判定 → プロンプト修正 → 再生成）の配線が正しいか」を
 * 課金もレート制限も無しで CI から検証できるようにすることであって、
 * 判定の賢さではない。
 *
 * ## 決定性
 * 乱数も時刻も使わない。結果は **reviewer 種別 / criteria / 画像ラベル**だけから決まる。
 * `ReviewImage.path` と `imageDir` は**意図的に無視する**。画像を落とす置き場は判定のたびに作り直すため、
 * これを混ぜると同じ判定依頼でも結果がぶれて決定性が壊れる。
 */

export const STUB_VISION_REVIEWER_NAME = 'stub-vision-reviewer'

/** score から severity を決める境界。テストが期待値を書けるよう公開する。 */
export const STUB_SEVERITY_THRESHOLDS = Object.freeze({
  /** これ以上なら info（指摘なし）。 */
  info: 0.75,
  /** これ以上なら warn。下回れば fail。 */
  warn: 0.5,
})

export const severityForScore = (score: number): Severity =>
  score >= STUB_SEVERITY_THRESHOLDS.info
    ? 'info'
    : score >= STUB_SEVERITY_THRESHOLDS.warn
      ? 'warn'
      : 'fail'

/**
 * severity を強制したときに score を収める帯。
 * 上限を境界値より僅かに下げてあるため、`severityForScore(score)` は必ず元の severity に戻る。
 */
const SCORE_BANDS: Readonly<Record<Severity, readonly [number, number]>> = Object.freeze({
  info: [STUB_SEVERITY_THRESHOLDS.info, 1],
  warn: [STUB_SEVERITY_THRESHOLDS.warn, 0.749],
  fail: [0, 0.499],
})

/** FNV-1a 32bit。暗号用途ではなく、判定結果を入力から決定的に導くためだけに使う。 */
const fnv1a32 = (value: string): number => {
  const OFFSET_BASIS = 0x811c9dc5
  const PRIME = 0x01000193
  let hash = OFFSET_BASIS
  for (let i = 0; i < value.length; i += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(i), PRIME)
  }
  return hash >>> 0
}

/**
 * 判定依頼を 1 本の文字列へ正規化する。URL を含めないことが要点。
 * 区切りに改行を使い、ラベルの連結で衝突が起きないようにしている。
 */
export const canonicalizeReviewRequest = (request: VisionReviewRequest): string =>
  [
    `reviewer=${request.reviewer}`,
    `criteria=${request.criteria}`,
    `subjects=${request.subjects.map((image) => image.label).join('|')}`,
    `references=${request.references.map((image) => image.label).join('|')}`,
  ].join('\n')

/** 判定依頼の決定的なダイジェスト。テストが期待値を計算できるよう公開する。 */
export const digestReviewRequest = (request: VisionReviewRequest): number =>
  fnv1a32(canonicalizeReviewRequest(request))

const round3 = (value: number): number => Math.round(value * 1000) / 1000

/** ダイジェストから 0..1 の score を作る。0.001 刻みで、浮動小数の揺れを持ち込まない。 */
export const scoreFromDigest = (digest: number): number => round3((digest % 1001) / 1000)

/** score を指定 severity の帯へ線形に写す。入力依存を保ったまま severity だけを固定する。 */
const clampToSeverity = (score: number, severity: Severity): number => {
  const [min, max] = SCORE_BANDS[severity]
  return round3(min + score * (max - min))
}

/** ラベル `frame@1.5s` から秒数を読む。読めなければ null（port.ts の規定どおり）。 */
export const frameSecFromLabel = (label: string): number | null => {
  const matched = /@(\d+(?:\.\d+)?)s$/.exec(label)
  if (matched === null) return null
  const [, captured] = matched
  if (captured === undefined) return null
  const parsed = Number.parseFloat(captured)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * レビュアごとの修正指示。**「頑張って」のような指示を返さない**（port.ts の方針）。
 * 再生成ループがそのままプロンプト差分として使える具体的な文にしてある。
 */
const DELTA_BY_REVIEWER: Readonly<Record<ReviewerType, string>> = Object.freeze({
  identity: '参照画像の顔に合わせ、輪郭・髪型・目の形を一致させる',
  continuity: '直前 Shot の最終フレームに合わせ、衣装・照明・背景の連続性を保つ',
  composition: '被写体を三分割構図の交点に置き、頭上の余白を画面高の 10% に収める',
  prompt_adherence: '指示文に挙げた要素を省略せず、すべて画面内に描画する',
  brand: 'ブランド指定色とロゴを画面内に入れる',
  technical: '尺・解像度・fps を spec の指定値に合わせる',
  music: 'カット点を直近のビートへスナップさせる',
})

const buildPromptDelta = (request: VisionReviewRequest): string => {
  const [firstReference] = request.references
  const base = DELTA_BY_REVIEWER[request.reviewer]
  return firstReference === undefined ? base : `${base}（基準: ${firstReference.label}）`
}

const buildMessage = (request: VisionReviewRequest, score: number, severity: Severity): string => {
  const subjects = request.subjects.map((image) => image.label).join(', ')
  const references = request.references.map((image) => image.label).join(', ')
  const comparedTo = references.length === 0 ? '参照画像なし' : references
  return `[stub] ${request.reviewer} の一致度は ${score}（${severity}）。判定対象 ${subjects} を ${comparedTo} と比較した。`
}

/** 判定結果の強制指定。`auto` はダイジェスト由来。 */
export const StubOutcomeMode = z.enum(['auto', 'info', 'warn', 'fail'])
export type StubOutcomeMode = z.infer<typeof StubOutcomeMode>

export const StubVisionReviewerOptions = z.object({
  name: z.string().min(1).default(STUB_VISION_REVIEWER_NAME),
  /** 既定は LLM 判定が要るレビュアのみ（ADR-0005）。決定的レビュアはここでは扱わない。 */
  supports: z.array(ReviewerType).min(1).default([...LLM_REVIEWERS]),
  /**
   * 判定結果を固定する。既定の `auto` は入力から決まるため、
   * **「常に pass」にならず fail 経路も自然に通る**。
   * 再生成ループのテストで fail → pass を狙って再現したいときに `fail` / `info` を使う。
   */
  outcome: StubOutcomeMode.default('auto'),
})
export type StubVisionReviewerOptions = {
  name?: string
  supports?: readonly ReviewerType[]
  outcome?: StubOutcomeMode
}

/** 判定の中身だけを計算する純関数。Provider を組まずに期待値を確かめられるよう公開する。 */
export const stubReviewResult = (
  request: VisionReviewRequest,
  outcome: StubOutcomeMode = 'auto',
): VisionReviewResult => {
  const rawScore = scoreFromDigest(digestReviewRequest(request))
  const score = outcome === 'auto' ? rawScore : clampToSeverity(rawScore, outcome)
  const severity = severityForScore(score)
  const [firstSubject] = request.subjects

  return {
    severity,
    score,
    message: buildMessage(request, score, severity),
    frameSec: firstSubject === undefined ? null : frameSecFromLabel(firstSubject.label),
    // 直すべき点が無ければ null を返す（port.ts の規定）。
    suggestedPromptDelta: severity === 'info' ? null : buildPromptDelta(request),
  }
}

/**
 * 決定的なスタブ vision レビュア。
 * `costUsd` は常に 0。実際に払っていないため、推測値を入れない（port.ts の規定）。
 */
export const createStubVisionReviewer = (
  options: StubVisionReviewerOptions = {},
): VisionReviewer => {
  const { name, supports, outcome } = StubVisionReviewerOptions.parse(options)
  const frozenSupports: readonly ReviewerType[] = Object.freeze([...supports])

  const reviewSync = (request: VisionReviewRequest): VisionReviewOutcome => {
    // API 境界と同じく入力は必ず検証する（CLAUDE.md 規約 4）。
    const parsed = VisionReviewRequest.parse(request)

    if (!frozenSupports.includes(parsed.reviewer)) {
      throw new UnsupportedReviewerError(frozenSupports, {
        reviewer: parsed.reviewer,
        command: '(stub: サブプロセスを起動しない)',
        adapter: name,
      })
    }

    return { result: stubReviewResult(parsed, outcome), costUsd: 0 }
  }

  // interface が Promise を返す以上、検証失敗も同期 throw ではなく reject で返す
  // （スタブ動画 Provider の未知ハンドル処理と同じ扱い）。
  const review = (request: VisionReviewRequest): Promise<VisionReviewOutcome> =>
    Promise.resolve().then(() => reviewSync(request))

  return { name, supports: frozenSupports, review }
}
