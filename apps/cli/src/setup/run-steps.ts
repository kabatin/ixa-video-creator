import { formatStep, type Output } from '../printer.js'
import { isStopping, type StepResult } from '../types.js'

/** 1 手順。1 つか複数の結果を返す（道具は足りないものを全部並べる）。 */
export type Step<C> = (ctx: C) => Promise<StepResult | readonly StepResult[]>

const asList = (r: StepResult | readonly StepResult[]): readonly StepResult[] =>
  'id' in r ? [r] : r

/** 手順を順に回して 1 つずつ表示し、止まる手順が出たらそこで止める（それより先は回さない）。 */
export const runSteps = async <C>(ctx: C, steps: readonly Step<C>[], out: Output): Promise<readonly StepResult[]> => {
  const [head, ...rest] = steps
  if (head === undefined) return []
  const results = asList(await head(ctx))
  results.forEach((r) => out.line(formatStep(r)))
  if (results.some(isStopping)) return results
  return [...results, ...(await runSteps(ctx, rest, out))]
}
