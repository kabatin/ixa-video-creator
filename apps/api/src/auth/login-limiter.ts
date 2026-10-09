/**
 * 合言葉の総当たりを止める。**同じ相手が 15 分に 5 回まちがえたら、しばらく受けない。**
 *
 * 覚えるのはこの API の中だけ（再起動で忘れる）。使う人は 1 人で、LAN の中の総当たりを
 * 遅くできれば足りるので、DB にも Redis にも置かない。
 */

export const LOGIN_MAX_FAILURES = 5
export const LOGIN_WINDOW_MS = 15 * 60 * 1000

export type LoginLimiter = {
  /** あと何ミリ秒待てば受けるか。受けられるなら null。 */
  readonly blockedForMs: (key: string, nowMs: number) => number | null
  readonly recordFailure: (key: string, nowMs: number) => void
  /** 当たったら数え直す。 */
  readonly reset: (key: string) => void
}

export const createLoginLimiter = (): LoginLimiter => {
  const failures = new Map<string, readonly number[]>()
  const recent = (key: string, nowMs: number): readonly number[] =>
    (failures.get(key) ?? []).filter((at) => nowMs - at < LOGIN_WINDOW_MS)

  return {
    blockedForMs: (key, nowMs) => {
      const within = recent(key, nowMs)
      const oldest = within[0]
      if (within.length < LOGIN_MAX_FAILURES || oldest === undefined) return null
      return LOGIN_WINDOW_MS - (nowMs - oldest)
    },
    recordFailure: (key, nowMs) => {
      failures.set(key, [...recent(key, nowMs), nowMs])
    },
    reset: (key) => {
      failures.delete(key)
    },
  }
}
