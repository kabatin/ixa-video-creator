/**
 * 生成中の Take 一覧を追いかけるためのポーリング。
 * 「いつ止まるか」を純粋関数へ切り出し、タイマー無しで検証できるようにする。
 * 止まらないポーリングはリクエストの垂れ流しとメモリリークになるため、
 * 停止条件はこのファイルの外に散らさない。
 */

export const POLL_INTERVAL_MS = 3_000

/** 最大 5 分。これを超えたら生成が終わっていなくても諦める。 */
export const POLL_TIMEOUT_MS = 5 * 60 * 1_000

export type PollStopReason = 'stopped' | 'timeout' | 'settled'

export type PollDecision =
  { readonly kind: 'continue' } | { readonly kind: 'stop'; readonly reason: PollStopReason }

export type PollState = {
  readonly startedAtMs: number
  readonly nowMs: number
  /** 呼び出し側が明示的に止めたか（画面離脱・手動停止）。 */
  readonly stopped: boolean
  /** 監視対象がまだ動いているか（Shot が generating か）。 */
  readonly running: boolean
  readonly timeoutMs?: number
}

const CONTINUE: PollDecision = { kind: 'continue' }

export const decidePoll = ({
  startedAtMs,
  nowMs,
  stopped,
  running,
  timeoutMs = POLL_TIMEOUT_MS,
}: PollState): PollDecision => {
  if (stopped) return { kind: 'stop', reason: 'stopped' }
  if (!running) return { kind: 'stop', reason: 'settled' }
  if (nowMs - startedAtMs >= timeoutMs) return { kind: 'stop', reason: 'timeout' }
  return CONTINUE
}

export type PollHandle = {
  readonly stop: () => void
}

export type StartPollingOptions = {
  readonly onTick: () => void
  readonly onStop?: (reason: PollStopReason) => void
  readonly intervalMs?: number
  readonly timeoutMs?: number
  readonly now?: () => number
}

/**
 * 一定間隔で `onTick` を呼び、上限時間に達したら自分で止まる。
 * 返り値の `stop()` は何度呼んでも安全で、呼んだ後は二度と `onTick` しない。
 */
export const startPolling = ({
  onTick,
  onStop,
  intervalMs = POLL_INTERVAL_MS,
  timeoutMs = POLL_TIMEOUT_MS,
  now = Date.now,
}: StartPollingOptions): PollHandle => {
  const startedAtMs = now()
  let timer: ReturnType<typeof setInterval> | null = null

  const clear = (): void => {
    if (timer === null) return
    clearInterval(timer)
    timer = null
  }

  const finish = (reason: PollStopReason): void => {
    clear()
    onStop?.(reason)
  }

  timer = setInterval(() => {
    const decision = decidePoll({
      startedAtMs,
      nowMs: now(),
      stopped: timer === null,
      running: true,
      timeoutMs,
    })
    if (decision.kind === 'stop') {
      finish(decision.reason)
      return
    }
    onTick()
  }, intervalMs)

  return { stop: clear }
}
