import { ProjectEvent } from '@ixa/domain'
import { projectEventChannel } from './channel.js'
import type { ProjectEvents } from './project-events.js'
import { createReporter, type ProjectEventsLogging } from './report.js'
import { createSubscriptionHub, type ChannelTransport } from './subscription.js'

/** メモリ版に配線は無い。参照カウントの数え方だけ Redis 版と共有する。 */
const NO_TRANSPORT: ChannelTransport = {
  attach: () => Promise.resolve(),
  detach: () => Promise.resolve(),
}

/**
 * プロセス内だけで出来事を回す版。テストと、Redis を立てない環境の起動用。
 *
 * publish は**同期的に**購読者へ配る。テストで `await publish()` の直後に
 * 受け取れていることを確かめられるようにするため。
 */
export const createMemoryProjectEvents = (options: ProjectEventsLogging = {}): ProjectEvents => {
  const hub = createSubscriptionHub(NO_TRANSPORT, createReporter(options))

  const publish = (event: ProjectEvent): Promise<void> => {
    // 形の検証は Redis 版と揃える。メモリ版で通る物が Redis 版で落ちると再現できない。
    const parsed = ProjectEvent.safeParse(event)
    // 失敗は「同期の例外」ではなく「拒否された Promise」で返す。
    // 呼び出し側は Redis 版と同じ書き方（.catch）で握れなければならない。
    if (!parsed.success) return Promise.reject(parsed.error)

    hub.deliver(projectEventChannel(parsed.data.projectId), parsed.data)
    return Promise.resolve()
  }

  return {
    publisher: { publish },
    subscriber: hub.subscriber,
    close: () => {
      hub.clear()
      return Promise.resolve()
    },
  }
}
