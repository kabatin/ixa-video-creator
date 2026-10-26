import type { CheckGroup, CheckResult, Fix, Level, StepResult, StepStatus } from './types.js'

/**
 * 表示の部品（ADR-0063）。**stdout に書くのはこのファイルだけ。**
 * 文を組み立てる関数は純粋（テストする）。書くのは `write` だけ。
 * `--json` のときは機械向けの 1 つの JSON だけを stdout に出す（進み具合は stderr）。
 */

const MARK: Readonly<Record<Level, string>> = { ok: '✓', warn: '!', fail: '✗', skip: '-' }

const STEP_MARK: Readonly<Record<StepStatus, string>> = {
  done: '✓',
  already: '✓',
  skipped: '-',
  notice: '!',
  needs_human: '!',
  failed: '✗',
}

const STEP_SUFFIX: Readonly<Record<StepStatus, string>> = {
  done: '',
  already: '（済み）',
  skipped: '（飛ばした）',
  notice: '',
  needs_human: '（人の操作が要る）',
  failed: '',
}

const GROUP_TITLE: Readonly<Record<CheckGroup, string>> = {
  tools: '道具',
  env: '設定',
  db: 'DB',
  runtime: '動いているもの',
  'local-ai': '手元の AI サーバー',
  optional: '任意',
}

export const formatFix = (fix: Fix): string => {
  const human = fix.needsHuman ? '［人の操作・同意が要る］' : ''
  return fix.command === undefined
    ? `      直し方: ${fix.hint}${human}`
    : `      直し方: ${fix.command}  … ${fix.hint}${human}`
}

/** doctor の表示（純粋）。 */
export const formatChecks = (results: readonly CheckResult[]): string =>
  results
    .flatMap((result, i) => {
      const startsGroup = i === 0 || results[i - 1]?.group !== result.group
      const header = startsGroup ? [`${i === 0 ? '' : '\n'}${GROUP_TITLE[result.group]}`] : []
      const showFix = result.fix !== undefined && (result.level === 'fail' || result.level === 'warn')
      return [
        ...header,
        `  ${MARK[result.level]} ${result.message}`,
        ...(showFix && result.fix !== undefined ? [formatFix(result.fix)] : []),
      ]
    })
    .join('\n')

export const summarize = (results: readonly CheckResult[]): string => {
  const count = (level: Level): number => results.filter((r) => r.level === level).length
  const fails = count('fail')
  return fails === 0
    ? `\n使えます（✓ ${String(count('ok'))}・! ${String(count('warn'))}）`
    : `\n直すところがあります（✗ ${String(fails)}・! ${String(count('warn'))}）。上の「直し方」を上から順に。`
}

/** setup・update の 1 手順（純粋）。 */
export const formatStep = (step: StepResult): string => {
  const head = `${STEP_MARK[step.status]} ${step.message}${STEP_SUFFIX[step.status]}`
  return step.fix === undefined || step.status === 'done' || step.status === 'already'
    ? head
    : `${head}\n${formatFix(step.fix)}`
}

export type Output = {
  readonly json: boolean
  /** 人向けの 1 行（`--json` では出さない）。 */
  readonly line: (text: string) => void
  /** 最後の答え。`--json` なら JSON、そうでなければ何もしない（人向けは line で出し終えている）。 */
  readonly result: (payload: unknown) => void
}

const write = (text: string): void => {
  process.stdout.write(`${text}\n`)
}

export const createOutput = (json: boolean): Output => ({
  json,
  line: (text) => {
    if (!json) write(text)
  },
  result: (payload) => {
    if (json) write(JSON.stringify(payload, null, 2))
  },
})
