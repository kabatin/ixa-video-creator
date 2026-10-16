import type { Clock } from '../tool-def.js'

/**
 * 終わるまで待つ（`wait`・`export`）。間隔を少しずつ広げて問い合わせ、`maxWaitSec` で必ず返す。
 * **MCP の 1 回の呼び出しを 1 時間ぶら下げない**（クライアントが切る・エージェントが固まる）。
 * 終わっていなければ `timedOut: true` で途中経過を返し、エージェントにもう一度呼んでもらう。
 */

export type CheckState = 'pending' | 'succeeded' | 'failed' | 'cancelled'

export type CheckResult = {
  readonly state: CheckState
  /** 状態の詳しいところ（進み具合・失敗の文・出来たものの ID）。 */
  readonly detail: Readonly<Record<string, unknown>>
}

export type Check = {
  readonly label: Readonly<Record<string, unknown>>
  readonly poll: () => Promise<CheckResult>
}

export type WaitOptions = {
  readonly maxWaitSec: number
  readonly initialDelayMs?: number
  readonly maxDelayMs?: number
  readonly onProgress?: (done: number, total: number) => Promise<void>
}

export type WaitOutcome = {
  readonly done: boolean
  readonly timedOut: boolean
  readonly elapsedSec: number
  readonly results: readonly (Readonly<Record<string, unknown>> & {
    readonly state: CheckState
  })[]
}

export const DEFAULT_INITIAL_DELAY_MS = 2_000
export const DEFAULT_MAX_DELAY_MS = 15_000
const BACKOFF = 1.5

const isTerminal = (result: CheckResult): boolean => result.state !== 'pending'

export const waitForChecks = async (
  checks: readonly Check[],
  clock: Clock,
  options: WaitOptions,
): Promise<WaitOutcome> => {
  const startedAt = clock.now()
  const deadline = startedAt + options.maxWaitSec * 1000
  const maxDelay = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS

  const loop = async (
    latest: readonly (CheckResult | null)[],
    delayMs: number,
  ): Promise<readonly CheckResult[]> => {
    // 終わったものは問い合わせ直さない。
    const results = await Promise.all(
      checks.map((check, i) => {
        const known = latest[i]
        return known !== null && known !== undefined && isTerminal(known) ? Promise.resolve(known) : check.poll()
      }),
    )
    const finished = results.filter(isTerminal).length
    await options.onProgress?.(finished, checks.length)
    if (finished === checks.length) return results
    const now = clock.now()
    if (now >= deadline) return results
    await clock.sleep(Math.min(delayMs, deadline - now))
    return loop(results, Math.min(maxDelay, Math.round(delayMs * BACKOFF)))
  }

  const results = await loop(
    checks.map(() => null),
    options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS,
  )
  const done = results.every(isTerminal)
  return {
    done,
    timedOut: !done,
    elapsedSec: Math.round((clock.now() - startedAt) / 100) / 10,
    results: results.map((result, i) => ({
      ...(checks[i] as Check).label,
      state: result.state,
      ...result.detail,
    })),
  }
}
