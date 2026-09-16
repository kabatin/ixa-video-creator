import { MAX_REGENERATION_REASON_LENGTH } from '@ixa/domain'
import type { RegenerationPolicy, ReviewFinding, ReviewerType, Severity } from '@ixa/domain'

/**
 * レビューの指摘から「次の生成で何を変えるか」を決める純粋関数
 * （docs/ARCHITECTURE.md §13 の対処方針の表）。
 *
 * **ここは IO をしない。** DB もキューも触らない。指摘の配列と policy だけで決まる。
 * 実際に prompt を書き換えるのは生成側の仕事で、ここは「何を変えるか」を
 * 構造化した値にするところまでを受け持つ。
 */

export type RegenerationActionKind =
  /** 参照画像の優先度を上げる（人物一致の崩れ）。 */
  | 'raise_reference_priority'
  /** seed を変える。同じ seed で回しても同じ絵が出るだけなので。 */
  | 'change_seed'
  /** camera fragment を強める（動き・構図の崩れ）。 */
  | 'strengthen_camera_fragment'
  /** 尺・解像度・fps などのパラメータを直す。 */
  | 'fix_parameters'
  /** prompt の文面を調整する。 */
  | 'adjust_prompt'

/**
 * レビュア種別ごとの対処方針（ARCHITECTURE.md §13）。
 * `motion fail` に相当するのは continuity / composition の 2 つ
 * （ReviewerType に motion という値は無い）。
 */
export const ACTIONS_BY_REVIEWER: Readonly<
  Record<ReviewerType, readonly RegenerationActionKind[]>
> = Object.freeze({
  identity: ['raise_reference_priority', 'change_seed'],
  continuity: ['strengthen_camera_fragment'],
  composition: ['strengthen_camera_fragment'],
  technical: ['fix_parameters'],
  music: ['fix_parameters'],
  brand: ['adjust_prompt'],
  prompt_adherence: ['adjust_prompt'],
})

export type RegenerationAction = {
  readonly kind: RegenerationActionKind
  readonly reviewer: ReviewerType
  readonly severity: Severity
  /** どの指摘から来た調整かを人が追えるようにする。 */
  readonly message: string
}

export type RegenerationAdjustment = {
  /** Take.regenerationReason に入れる文字列。 */
  readonly reason: string
  /** severity の高い順。同じ severity なら指摘の並び順を保つ。 */
  readonly actions: readonly RegenerationAction[]
  /** 指摘が出した suggestedPromptDelta。重複は除く。 */
  readonly promptDeltas: readonly string[]
  readonly changeSeed: boolean
}

export type RegenerationDecision =
  | { readonly kind: 'regenerate'; readonly adjustment: RegenerationAdjustment }
  /** 機械で回してはいけない指摘。人間に渡す。 */
  | { readonly kind: 'human'; readonly reason: string }

/**
 * `regenerationReason` の上限。**実体は `@ixa/domain` にある。**
 * ここに同じ値を書くと、DB 側の検証だけ変えた日に「保存はできるが投入で落ちる」
 * または「投入は通るが保存で落ちる」状態になる（L-016）。
 */
export const MAX_REASON_LENGTH = MAX_REGENERATION_REASON_LENGTH

const SEVERITY_RANK: Readonly<Record<Severity, number>> = Object.freeze({
  fail: 2,
  warn: 1,
  info: 0,
})

/** severity の高い順。同順位は元の並びを保つ（Array#sort は安定）。 */
const bySeverityDesc = (
  a: Pick<ReviewFinding, 'severity'>,
  b: Pick<ReviewFinding, 'severity'>,
): number => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]

const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`

const uniqueStrings = (values: readonly string[]): readonly string[] => [...new Set(values)]

const uniqueReviewers = (
  findings: readonly Pick<ReviewFinding, 'reviewer'>[],
): readonly ReviewerType[] => [...new Set(findings.map((f) => f.reviewer))]

/** 同じ (kind, reviewer) の調整を 2 回返さない。 */
const dedupeActions = (actions: readonly RegenerationAction[]): readonly RegenerationAction[] => {
  const seen = new Set<string>()
  return actions.filter((action) => {
    const key = `${action.kind}:${action.reviewer}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const actionsFor = (finding: ReviewFinding): readonly RegenerationAction[] =>
  ACTIONS_BY_REVIEWER[finding.reviewer].map((kind) => ({
    kind,
    reviewer: finding.reviewer,
    severity: finding.severity,
    message: finding.message,
  }))

const reasonFrom = (
  findings: readonly ReviewFinding[],
  top: ReviewFinding,
): string => {
  const reviewers = uniqueReviewers(findings).join(', ')
  return truncate(`レビュー指摘による自動再生成 [${reviewers}]: ${top.message}`, MAX_REASON_LENGTH)
}

/**
 * 指摘から次の生成の調整を決める。
 *
 * - `autoRegenerateOn` に無いレビュア種別が fail を出しているなら、**機械は回さない。**
 *   構図や連続性の崩れを機械が勝手に回し続けると、人が判断すべきものが
 *   予算だけ消費して消える。
 * - 対処は severity の高いものから。
 */
export const decideRegenerationAdjustment = (
  policy: Pick<RegenerationPolicy, 'autoRegenerateOn'>,
  findings: readonly ReviewFinding[],
): RegenerationDecision => {
  const isAuto = (reviewer: ReviewerType): boolean => policy.autoRegenerateOn.includes(reviewer)

  const blocking = findings.filter((f) => f.severity === 'fail')
  if (blocking.length === 0) {
    return {
      kind: 'human',
      reason: 'fail の指摘が無いため、何を直せばよいか決められません',
    }
  }

  const manual = blocking.filter((f) => !isAuto(f.reviewer))
  if (manual.length > 0) {
    return {
      kind: 'human',
      reason: `自動再生成の対象外のレビュアが fail を出しています: ${uniqueReviewers(manual).join(', ')}`,
    }
  }

  // 対処できる指摘だけを severity の高い順に並べる。
  // warn / info も調整には使うが、fail が無ければそもそもここへ来ない。
  const actionable = [...findings].filter((f) => isAuto(f.reviewer)).sort(bySeverityDesc)
  const top = actionable[0]
  if (top === undefined) {
    // blocking が空でない以上ここには来ないが、型の上で undefined を潰しておく。
    return { kind: 'human', reason: '対処できる指摘がありません' }
  }

  const actions = dedupeActions(actionable.flatMap(actionsFor))
  const promptDeltas = uniqueStrings(
    actionable
      .map((f) => f.suggestedPromptDelta)
      .filter((delta): delta is string => delta !== null && delta.trim().length > 0)
      .map((delta) => delta.trim()),
  )

  return {
    kind: 'regenerate',
    adjustment: {
      reason: reasonFrom(actionable, top),
      actions,
      promptDeltas,
      changeSeed: actions.some((a) => a.kind === 'change_seed'),
    },
  }
}
