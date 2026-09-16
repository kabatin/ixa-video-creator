import type { ReviewFinding, ReviewRun, ReviewerType, Severity, Verdict } from '@ixa/domain'
import { formatSeconds } from '@/lib/shot-display'
import type { HumanDecision } from '@/lib/review-api'

/**
 * レビュー結果の表示用ラベル・色・並び順。React を含まない純粋関数だけを置く。
 * キーをドメインの union にすることで、enum が増えたときに型で気付ける。
 *
 * **色は意味と一致させること。** fail を緑にしない。
 */

const SEVERITY_LABELS: Readonly<Record<Severity, string>> = {
  info: '情報',
  warn: '警告',
  fail: '不合格',
}

const SEVERITY_CLASSES: Readonly<Record<Severity, string>> = {
  info: 'bg-slate-100 text-slate-700 ring-slate-200',
  warn: 'bg-amber-100 text-amber-900 ring-amber-300',
  fail: 'bg-red-100 text-red-800 ring-red-300',
}

export const findingSeverityLabel = (severity: Severity): string => SEVERITY_LABELS[severity]

export const findingSeverityClassName = (severity: Severity): string => SEVERITY_CLASSES[severity]

const VERDICT_LABELS: Readonly<Record<Verdict, string>> = {
  pass: '合格',
  warn: '警告あり',
  fail: '不合格',
}

const VERDICT_CLASSES: Readonly<Record<Verdict, string>> = {
  pass: 'bg-emerald-100 text-emerald-800 ring-emerald-300',
  warn: 'bg-amber-100 text-amber-900 ring-amber-300',
  fail: 'bg-red-100 text-red-800 ring-red-300',
}

/** verdict が null なのは「まだ判定が出ていない」。合格と混同させない。 */
export const reviewVerdictLabel = (verdict: Verdict | null): string =>
  verdict === null ? '判定待ち' : VERDICT_LABELS[verdict]

export const reviewVerdictClassName = (verdict: Verdict | null): string =>
  verdict === null ? 'bg-slate-100 text-slate-600 ring-slate-200' : VERDICT_CLASSES[verdict]

const RUN_STATUS_LABELS: Readonly<Record<ReviewRun['status'], string>> = {
  queued: '待機中',
  running: '実行中',
  done: '完了',
  failed: '実行に失敗',
}

export const reviewRunStatusLabel = (status: ReviewRun['status']): string =>
  RUN_STATUS_LABELS[status]

/** 実行中は結果がまだ動く。画面に「引き直してください」と出すための判定。 */
export const isReviewRunPending = (status: ReviewRun['status']): boolean =>
  status === 'queued' || status === 'running'

const REVIEWER_LABELS: Readonly<Record<ReviewerType, string>> = {
  technical: '技術（尺・解像度・fps）',
  music: '音楽（ビート整合）',
  brand: 'ブランド（ロゴ・色）',
  identity: '人物一致',
  continuity: '前後の整合',
  composition: '構図',
  prompt_adherence: '記述との一致',
}

export const reviewerLabel = (reviewer: ReviewerType): string => REVIEWER_LABELS[reviewer]

const HUMAN_DECISION_LABELS: Readonly<Record<HumanDecision, string>> = {
  approved: '承認',
  rejected: '却下',
}

export const humanDecisionLabel = (decision: HumanDecision): string =>
  HUMAN_DECISION_LABELS[decision]

/**
 * 最新の ReviewRun。API の並び順に依存しないよう、こちらで createdAt から決める。
 * 同時刻なら配列の後ろを新しいとみなす（追記順）。空なら null。
 */
export const latestReviewRun = <T extends { readonly createdAt: Date }>(
  runs: readonly T[],
): T | null =>
  runs.reduce<T | null>(
    (newest, run) =>
      newest === null || run.createdAt.getTime() >= newest.createdAt.getTime() ? run : newest,
    null,
  )

/** 重い指摘から順に読ませる。 */
const SEVERITY_ORDER: Readonly<Record<Severity, number>> = { fail: 0, warn: 1, info: 2 }

type SortableFinding = Pick<ReviewFinding, 'severity' | 'evidence'>

const frameSecOf = (finding: SortableFinding): number =>
  finding.evidence?.frameSec ?? Number.POSITIVE_INFINITY

/**
 * fail → warn → info の順。同じ severity 内は指摘された秒の早い順。
 * 元の配列は変更せず、新しい配列を返す。
 */
export const sortFindings = <T extends SortableFinding>(findings: readonly T[]): T[] =>
  [...findings].sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    return bySeverity === 0 ? frameSecOf(a) - frameSecOf(b) : bySeverity
  })

export type FindingCounts = {
  readonly fail: number
  readonly warn: number
  readonly info: number
  readonly total: number
}

export const summarizeFindings = (
  findings: readonly Pick<ReviewFinding, 'severity'>[],
): FindingCounts => {
  const counted = findings.reduce(
    (counts, finding) => ({ ...counts, [finding.severity]: counts[finding.severity] + 1 }),
    { fail: 0, warn: 0, info: 0 },
  )
  return { ...counted, total: findings.length }
}

/** 「何秒地点の指摘か」。証拠が無ければ null を返し、呼び出し側で出し分ける。 */
export const formatEvidenceMoment = (
  evidence: ReviewFinding['evidence'],
): string | null =>
  evidence === null || evidence.frameSec === null ? null : `${formatSeconds(evidence.frameSec)} 地点`

/** レビュー結果の一行要約。指摘が無いことも明示する。 */
export const summarizeRun = (
  run: Pick<ReviewRun, 'status' | 'verdict'>,
  counts: FindingCounts,
): string => {
  if (isReviewRunPending(run.status)) return `${reviewRunStatusLabel(run.status)}です`
  if (run.status === 'failed') return 'レビューの実行に失敗しました'
  if (counts.total === 0) return `${reviewVerdictLabel(run.verdict)}（指摘なし）`
  return `${reviewVerdictLabel(run.verdict)}（不合格 ${String(counts.fail)} / 警告 ${String(counts.warn)} / 情報 ${String(counts.info)}）`
}
