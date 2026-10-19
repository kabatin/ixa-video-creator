import { z } from 'zod'
import { ImageCheckId, ImageGenerationJobId } from '../common/ids.js'

/**
 * 作った画像のチェック（ADR-0055。制作者 2026-10-19「破綻・矛盾のような、どう見てもリテイクを自動で見つけてやり直したい」）。
 *
 * 対象は画像のジョブの 3 種類（開始フレーム・キャラクターシート・キーアート）。見るのは破綻（手足・指・顔の崩れ、
 * 溶けた物、意味の無い文字）と矛盾（指示の主要素の欠落、参照と別人、Look の服や色の違い）。
 *
 * **判定は甘めにする。** `retry` は誰が見てもリテイクのときだけ。好みの問題は `review` か `pass`。
 * やり直しすぎて手元の GPU を占有しないことを優先する。
 */

/** 問題なし・要確認・やり直す。 */
export const ImageCheckVerdict = z.enum(['pass', 'review', 'retry'])
export type ImageCheckVerdict = z.infer<typeof ImageCheckVerdict>

/**
 * 破綻（anatomy・artifact・text）と矛盾（identity・prompt・look・proportion）。
 * `proportion` は頭身・等身・体型のバランスの違い。`look` は服・髪・色の違い。
 */
export const ImageCheckIssueKind = z.enum(['anatomy', 'artifact', 'text', 'identity', 'prompt', 'look', 'proportion'])
export type ImageCheckIssueKind = z.infer<typeof ImageCheckIssueKind>

/**
 * やり直す理由になる種類（チームリーダー 2026-10-19）。**意味の無い文字（text）と頭身（proportion）は入れない。**
 * klein では文字は直らず GPU を使うだけ。デフォルメの頭身は作品の画風として意図したもの。
 */
export const RETRY_ISSUE_KINDS: readonly ImageCheckIssueKind[] = ['anatomy', 'artifact', 'identity', 'prompt', 'look']

export const IMAGE_CHECK_ISSUE_MESSAGE_MAX_LENGTH = 200
export const IMAGE_CHECK_MAX_ISSUES = 8
export const IMAGE_CHECK_PROMPT_DELTA_MAX_LENGTH = 500

export const ImageCheckIssue = z.object({
  kind: ImageCheckIssueKind,
  /** 利用者に見せる日本語の 1 文。 */
  message: z.string().trim().min(1).max(IMAGE_CHECK_ISSUE_MESSAGE_MAX_LENGTH),
})
export type ImageCheckIssue = z.infer<typeof ImageCheckIssue>

const PromptDelta = z.string().trim().min(1).max(IMAGE_CHECK_PROMPT_DELTA_MAX_LENGTH).nullable()

/**
 * チェックの AI が返す形。**自由文を返させない**（ADR-0012 と同じ）。通らなければ「チェックに失敗した」として残す。
 * 理由の無い `retry` は通さない（理由の言えないやり直しで GPU を使わない）。
 */
export const ImageCheckResult = z
  .object({
    verdict: ImageCheckVerdict,
    /** 0〜1。1 が申し分ない。 */
    score: z.number().min(0).max(1),
    issues: z.array(ImageCheckIssue).max(IMAGE_CHECK_MAX_ISSUES),
    /** やり直すときに指示へ足す英語の直し方。直す点が無ければ null。 */
    promptDelta: PromptDelta,
  })
  .refine((result) => result.verdict !== 'retry' || result.issues.length > 0, {
    message: 'やり直す判定には理由が要ります',
    path: ['issues'],
  })
export type ImageCheckResult = z.infer<typeof ImageCheckResult>

/**
 * 見た（`checked`）・飛ばした（`skipped`。文章の AI が Claude ではない）・落ちた（`failed`。CLI の失敗・壊れた応答）。
 * **飛ばした・落ちたを「合格」に化けさせない**ため、判定とは別の列で持つ。
 */
export const ImageCheckOutcome = z.enum(['checked', 'skipped', 'failed'])
export type ImageCheckOutcome = z.infer<typeof ImageCheckOutcome>

/**
 * 1 枚の絵のチェックの記録（`image_checks`。ジョブに 1 行・追記のみ）。
 * 検査（`imageCheckViolation`）はここに付けない（`ImageGenerationJob` と同じ方針。`.refine()` は派生を妨げる）。
 */
export const ImageCheck = z.object({
  id: ImageCheckId,
  imageJobId: ImageGenerationJobId,
  outcome: ImageCheckOutcome,
  verdict: ImageCheckVerdict.nullable(),
  score: z.number().min(0).max(1).nullable(),
  issues: z.array(ImageCheckIssue).max(IMAGE_CHECK_MAX_ISSUES),
  promptDelta: PromptDelta,
  /** 飛ばした・落ちた理由（利用者に見せる文）。見たときは null。 */
  note: z.string().min(1).nullable(),
  /** 実際に払った額。測れなければ 0（推測値を入れない）。 */
  costUsd: z.number().nonnegative(),
  createdAt: z.date(),
})
export type ImageCheck = z.infer<typeof ImageCheck>

/** 中身の食い違い。成り立っていれば null。**規則はここ 1 箇所**（書く側も読み直す側も呼ぶ）。 */
export const imageCheckViolation = (
  check: Pick<ImageCheck, 'outcome' | 'verdict' | 'score' | 'note'>,
): string | null => {
  if (check.outcome === 'checked') {
    if (check.verdict === null) return '見たのに判定がありません'
    if (check.score === null) return '見たのに点がありません'
    return null
  }
  if (check.verdict !== null || check.score !== null) return '見ていないのに判定があります'
  if (check.note === null) return '見ていないのに理由がありません'
  return null
}

/** 自動のやり直しの上限（回数）。既定 2 回 = 最初の 1 枚と合わせて最大 3 枚。 */
export const IMAGE_CHECK_DEFAULT_MAX_RETRIES = 2
/** 設定で変えられる上限の上限。これより多いと GPU を長く占有する。 */
export const IMAGE_CHECK_MAX_RETRIES_LIMIT = 5
export const ImageCheckMaxRetries = z.number().int().min(0).max(IMAGE_CHECK_MAX_RETRIES_LIMIT)

/**
 * 自動でやり直すか。`attempt` は 1 から数える（最初の 1 枚が 1）。
 * やり直すのは **手元の AI（`exclusiveResource: 'local-gpu'`）** で `retry` と判定されたときだけ。
 * 利用枠や料金を使う AI では人が押す（ADR-0055 §4）。
 */
export const shouldAutoRetry = (input: {
  readonly check: ImageCheck | null
  readonly attempt: number
  readonly maxRetries: number
  readonly toolIsLocal: boolean
}): boolean =>
  input.toolIsLocal &&
  input.check?.outcome === 'checked' &&
  input.check.verdict === 'retry' &&
  input.attempt <= input.maxRetries

/** やり直しのつながりの 1 枚（絵があるものだけを渡す）。 */
export type ImageChainEntry = {
  readonly jobId: ImageGenerationJobId
  /** 1 から数える。新しさはこれで決める（並び順に頼らない）。 */
  readonly attempt: number
  readonly check: ImageCheck | null
}

/** 画面の印。見ていない絵は `unchecked`。 */
export type ImageCheckMark = ImageCheckVerdict | 'unchecked'

export const imageCheckMark = (check: ImageCheck | null): ImageCheckMark =>
  check?.outcome === 'checked' && check.verdict !== null ? check.verdict : 'unchecked'

/** 合格が無いときの順位。要確認 → 見ていない → やり直し（ADR-0055 §5）。 */
const FALLBACK_RANK: Readonly<Record<Exclude<ImageCheckMark, 'pass'>, number>> = {
  review: 0,
  unchecked: 1,
  retry: 2,
}

const isBetterFallback = (a: ImageChainEntry, b: ImageChainEntry): boolean => {
  const markA = imageCheckMark(a.check)
  const markB = imageCheckMark(b.check)
  const rankA = markA === 'pass' ? -1 : FALLBACK_RANK[markA]
  const rankB = markB === 'pass' ? -1 : FALLBACK_RANK[markB]
  if (rankA !== rankB) return rankA < rankB
  const scoreA = a.check?.score ?? 0
  const scoreB = b.check?.score ?? 0
  if (scoreA !== scoreB) return scoreA > scoreB
  return a.attempt > b.attempt
}

/**
 * つながりの最後に当てる絵。合格した最新、無ければ順位（要確認 → 見ていない → やり直し）・点・新しさで選び、要確認の印を付ける。
 * 絵が 1 枚も無ければ null。
 */
export const pickImageToApply = (
  entries: readonly ImageChainEntry[],
): { readonly jobId: ImageGenerationJobId; readonly needsReview: boolean } | null => {
  const passed = entries
    .filter((entry) => imageCheckMark(entry.check) === 'pass')
    .reduce<ImageChainEntry | null>((best, entry) => (best === null || entry.attempt > best.attempt ? entry : best), null)
  if (passed !== null) return { jobId: passed.jobId, needsReview: false }
  const fallback = entries.reduce<ImageChainEntry | null>(
    (best, entry) => (best === null || isBetterFallback(entry, best) ? entry : best),
    null,
  )
  return fallback === null ? null : { jobId: fallback.jobId, needsReview: true }
}

/** やり直すときの指示。前の絵の直し方を足す（無ければ元のまま）。 */
export const appendRetryDelta = (prompt: string, promptDelta: string | null): string =>
  promptDelta === null ? prompt : `${prompt}\n\nFix from the previous attempt: ${promptDelta}`

/**
 * AI の判定を、理由の種類で決め直す。やり直す理由になる種類（`RETRY_ISSUE_KINDS`）が 1 つも無い `retry` は
 * `review` に下げる。**指示の文章だけに頼らない**（AI は指示を守らないことがある）。上げることはしない。
 */
export const enforceImageCheckVerdict = (result: ImageCheckResult): ImageCheckResult =>
  result.verdict === 'retry' && !result.issues.some((issue) => RETRY_ISSUE_KINDS.includes(issue.kind))
    ? { ...result, verdict: 'review' }
    : result

type Settleable = { readonly queuedAt: Date; readonly appliedAt: Date | null }

/**
 * つながり（1 枚目から `current` まで）のうち、当てる絵を選ぶ範囲。もう当て終わっていれば null。
 *
 * - `current` が頼まれたより**後**に当てた絵があれば、このつながりは当て終わっている（投げ直しで二重に当てない）
 * - `current` が頼まれた時刻以前に当てた絵は、前のつながりの結果。人が押したやり直しはその後に始まる
 *   新しいつながりなので、前の当てより後のジョブだけから選ぶ（レビューの指摘 2026-10-19。前の当てで止めると、
 *   やり直した絵が開始フレームにも識別画像にも入らなかった）
 */
export const chainToSettle = <J extends Settleable>(chain: readonly J[], current: Settleable): readonly J[] | null => {
  const queued = current.queuedAt.getTime()
  const applied = chain.flatMap((job) => (job.appliedAt === null ? [] : [job.appliedAt.getTime()]))
  if (applied.some((at) => at > queued)) return null
  const boundary = applied.reduce((latest, at) => Math.max(latest, at), Number.NEGATIVE_INFINITY)
  return chain.filter((job) => job.appliedAt === null && job.queuedAt.getTime() >= boundary)
}
