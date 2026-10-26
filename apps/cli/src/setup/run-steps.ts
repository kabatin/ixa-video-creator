import { dbErrorReason } from '../lib/db-error.js'
import { errorMessage } from '../lib/errors.js'
import { formatStep, type Output } from '../printer.js'
import { isStopping, type StepResult } from '../types.js'

/** 1 手順。1 つか複数の結果を返す（道具は足りないものを全部並べる）。 */
export type Step<C> = (ctx: C) => Promise<StepResult | readonly StepResult[]>

const asList = (r: StepResult | readonly StepResult[]): readonly StepResult[] => ('id' in r ? [r] : r)

/** 手順が投げたときの結果。理由は伏せた文で、DB の失敗は code だけ。続きを回す 1 行を付ける。 */
const thrown = (error: unknown, retry: string): StepResult => {
  const reason = dbErrorReason(error)
  return {
    id: 'step.error',
    status: 'failed',
    message: `途中で失敗しました: ${errorMessage(error)}${reason === '読めません' ? '' : `（DB: ${reason}）`}`,
    fix: { hint: '原因を直して、続きを回す（済んだ手順は飛ばす）', command: retry, needsHuman: false },
  }
}

const runOne = async <C>(ctx: C, step: Step<C>, retry: string): Promise<readonly StepResult[]> => {
  try {
    return asList(await step(ctx))
  } catch (error) {
    return [thrown(error, retry)]
  }
}

/**
 * 手順を順に回して 1 つずつ表示し、止まる手順が出たらそこで止める（それより先は回さない）。
 * **手順が投げても、失敗の手順にして止める**（`--json` の答えを 1 つ出しきり、続きの 1 行を付ける）。
 */
export const runSteps = async <C>(
  ctx: C,
  steps: readonly Step<C>[],
  out: Output,
  retry: string,
): Promise<readonly StepResult[]> => {
  const [head, ...rest] = steps
  if (head === undefined) return []
  const results = await runOne(ctx, head, retry)
  results.forEach((r) => out.line(formatStep(r)))
  if (results.some(isStopping)) return results
  return [...results, ...(await runSteps(ctx, rest, out, retry))]
}
