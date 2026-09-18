import type { ProjectEvent, ProjectEventSubscriber, ProjectId } from '@ixa/domain'
import { projectEventChannel } from './channel.js'
import { createChannelRegistry, type ListenerRecord } from './registry.js'
import type { EventsReporter } from './report.js'

/**
 * 購読の出入りを数え、0 → 1 と 1 → 0 のときだけ実際の配線に触る。
 * Redis 版とメモリ版でこの数え方が違うと、片方だけ接続が漏れる。
 */
export type ChannelTransport = {
  /** 購読者が 0 → 1 になったときだけ呼ばれる */
  readonly attach: (channel: string) => Promise<void>
  /** 購読者が 1 → 0 になったときだけ呼ばれる */
  readonly detach: (channel: string) => Promise<void>
}

export type SubscriptionHub = {
  readonly subscriber: ProjectEventSubscriber
  /** そのチャンネルの購読者全員へ配る。1 人の失敗で他を止めない。 */
  readonly deliver: (channel: string, event: ProjectEvent) => void
  readonly count: (channel: string) => number
  readonly clear: () => void
}

export const createSubscriptionHub = (
  transport: ChannelTransport,
  reporter: EventsReporter,
): SubscriptionHub => {
  const registry = createChannelRegistry()
  /** 進行中の attach。2 人目が「繋がる前」に戻ると、その間の出来事を落とす。 */
  const attaching = new Map<string, Promise<void>>()

  const attach = async (channel: string): Promise<void> => {
    const started = transport.attach(channel)
    attaching.set(channel, started)
    try {
      await started
    } finally {
      if (attaching.get(channel) === started) attaching.delete(channel)
    }
  }

  const subscribe = async (
    projectId: ProjectId,
    onEvent: (event: ProjectEvent) => void,
  ): Promise<() => Promise<void>> => {
    const channel = projectEventChannel(projectId)
    const record: ListenerRecord = { notify: onEvent }
    const isFirst = registry.add(channel, record)

    try {
      if (isFirst) await attach(channel)
      else await attaching.get(channel)
    } catch (error) {
      // 繋がっていないのに購読者として数え続けると、次の 1 人目が来ても attach されない。
      registry.remove(channel, record)
      throw new Error(`出来事の購読を開始できませんでした（channel=${channel}）`, { cause: error })
    }

    let released = false
    return async () => {
      // 二重に呼ばれても数を余分に減らさない。SSE の切断と後片付けで 2 回来ることがある。
      if (released) return
      released = true

      const isLast = registry.remove(channel, record)
      if (!isLast) return

      try {
        await transport.detach(channel)
      } catch (error) {
        throw new Error(`出来事の購読を解除できませんでした（channel=${channel}）`, { cause: error })
      }
    }
  }

  const deliver = (channel: string, event: ProjectEvent): void => {
    for (const listener of registry.listeners(channel)) {
      try {
        listener.notify(event)
      } catch (error) {
        reporter.listenerFailed(channel, error)
      }
    }
  }

  return { subscriber: { subscribe }, deliver, count: registry.count, clear: registry.clear }
}
