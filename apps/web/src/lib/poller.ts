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

/**
 * 1 回の問い合わせの結果。
 * `running` は**監視対象がまだ動いているか**であって、問い合わせが成功したかではない。
 */
export type PollProbe<T> = {
  readonly running: boolean
  readonly value: T
}

export type StartAsyncPollingOptions<T> = {
  /** 状態を 1 回読む。例外は握り潰さず `onFailed` へ渡す。 */
  readonly probe: () => Promise<PollProbe<T>>
  /** 毎回の結果。まだ動いている間も画面を更新できるようにする。 */
  readonly onProbe?: (probe: PollProbe<T>) => void
  /** 監視対象が終わった。**「上限まで待って諦めた」と混ぜない。** */
  readonly onSettled?: (value: T) => void
  /** 上限に達した。終わったかどうかは分かっていない。 */
  readonly onTimeout?: () => void
  /** 問い合わせ自体が失敗した。ここで止める。黙って叩き続けない。 */
  readonly onFailed?: (error: unknown) => void
  readonly intervalMs?: number
  readonly timeoutMs?: number
  readonly now?: () => number
}

/**
 * 非同期の問い合わせを繰り返し、終わったら自分で止まる。
 *
 * 止まる理由は 4 つあり、**どれも別々に伝える**。
 * 終わった（settled）/ 上限まで待った（timeout）/ 問い合わせが失敗した（failed）/
 * 呼び出し側が止めた（stop）。まとめて「終わり」にすると、
 * 終わっていないものを終わったと見せてしまう（lessons L-015）。
 *
 * 上限は `timeoutMs`（既定 5 分 = 最大 100 回）。**無限に叩き続けない。**
 * 前の問い合わせが返る前に次を撃つこともしない（遅い API でリクエストが積み上がる）。
 */
export const startAsyncPolling = <T>({
  probe,
  onProbe,
  onSettled,
  onTimeout,
  onFailed,
  intervalMs = POLL_INTERVAL_MS,
  timeoutMs = POLL_TIMEOUT_MS,
  now = Date.now,
}: StartAsyncPollingOptions<T>): PollHandle => {
  const startedAtMs = now()
  let timer: ReturnType<typeof setInterval> | null = null
  let inFlight = false

  const clear = (): void => {
    if (timer === null) return
    clearInterval(timer)
    timer = null
  }

  const tick = async (): Promise<void> => {
    if (inFlight) return
    const decision = decidePoll({
      startedAtMs,
      nowMs: now(),
      stopped: timer === null,
      running: true,
      timeoutMs,
    })
    if (decision.kind === 'stop') {
      clear()
      if (decision.reason === 'timeout') onTimeout?.()
      return
    }

    inFlight = true
    try {
      const result = await probe()
      // 待っている間に止められていたら、もう画面へ書き戻さない。
      if (timer === null) return
      onProbe?.(result)
      if (!result.running) {
        clear()
        onSettled?.(result.value)
      }
    } catch (caught) {
      if (timer === null) return
      clear()
      onFailed?.(caught)
    } finally {
      inFlight = false
    }
  }

  timer = setInterval(() => {
    void tick()
  }, intervalMs)

  return { stop: clear }
}
