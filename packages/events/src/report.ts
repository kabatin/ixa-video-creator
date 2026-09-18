/**
 * 配信の途中で起きた「捨てるしかないが、黙って捨ててはいけない」事象の受け口。
 *
 * 読めない本文を握り潰すと、worker は流したつもり・画面は届かないまま、
 * どちらの側にも痕跡が残らない。飛ばした検査を空で返すのと同じ穴になる（lessons L-015）。
 */

/** 読めなかった本文。`raw` は呼び出し側が自分の責任で扱う。 */
export type InvalidProjectEvent = {
  readonly channel: string
  readonly raw: string
  /** zod / JSON のどこが読めなかったか。**値そのものは載せない。** */
  readonly reason: string
}

/** pino 互換の最小の口。`packages/events` はログ実装に依存しない。 */
export type EventsLogger = {
  readonly warn: (payload: Record<string, unknown>, message: string) => void
}

export type ProjectEventsLogging = {
  /** 読めない本文をここへ渡す。無ければ `logger` へ、それも無ければ process の警告へ。 */
  readonly onInvalid?: (report: InvalidProjectEvent) => void
  readonly logger?: EventsLogger
}

export type EventsReporter = {
  readonly invalid: (report: InvalidProjectEvent) => void
  readonly listenerFailed: (channel: string, error: unknown) => void
}

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const createReporter = (options: ProjectEventsLogging = {}): EventsReporter => {
  const { onInvalid, logger } = options

  const warn = (payload: Record<string, unknown>, message: string): void => {
    if (logger) {
      logger.warn(payload, message)
      return
    }
    // ログ関数すら無いときの最後の受け皿。console は使わない（CLAUDE.md 規約 9）。
    // 何も渡されなくても、必ずどこかに出る状態を保つ。
    process.emitWarning(`${message} ${JSON.stringify(payload)}`, 'IxaProjectEvents')
  }

  return {
    invalid: (report) => {
      if (onInvalid) {
        onInvalid(report)
        return
      }
      // 既定のログには `raw` を載せない。何が流れてくるか分からない場所であり、
      // 署名付き URL の類が混ざっていた場合にログへ焼き付けてしまう。
      warn(
        { channel: report.channel, reason: report.reason, bytes: report.raw.length },
        '読めない出来事を受け取った',
      )
    },
    listenerFailed: (channel, error) => {
      // 受け手 1 つの失敗で他の受け手への配信を止めない。ただし失敗は必ず残す。
      warn({ channel, reason: describeError(error) }, '出来事の受け手が失敗した')
    },
  }
}
