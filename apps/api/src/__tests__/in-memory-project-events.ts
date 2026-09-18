import type {
  ProjectEvent,
  ProjectEventPublisher,
  ProjectEventSubscriber,
  ProjectId,
} from '@ixa/domain'

/**
 * テスト用のメモリ版 publisher / subscriber。Redis には接続しない。
 * **`packages/events` の実装は import しない。** api が依存してよいのは domain の
 * `ProjectEventPublisher` / `ProjectEventSubscriber` だけで、配信の実体は注入される。
 */
export type InMemoryProjectEvents = ProjectEventPublisher &
  ProjectEventSubscriber & {
    /** 流された出来事。publish された順。 */
    readonly published: () => readonly ProjectEvent[]
    /** いま張られている購読の数。**接続の漏れはこれで見る。** */
    readonly subscriberCount: () => number
    /** 解除が呼ばれた回数。0 のままなら購読が残っている。 */
    readonly unsubscribeCount: () => number
  }

export const createInMemoryProjectEvents = (): InMemoryProjectEvents => {
  const published: ProjectEvent[] = []
  const listeners = new Map<ProjectId, Set<(event: ProjectEvent) => void>>()
  let unsubscribeCount = 0

  return {
    published: () => published,
    subscriberCount: () =>
      [...listeners.values()].reduce((total, set) => total + set.size, 0),
    unsubscribeCount: () => unsubscribeCount,

    publish: (event) => {
      published.push(event)
      for (const listener of listeners.get(event.projectId) ?? []) listener(event)
      return Promise.resolve()
    },

    subscribe: (projectId, onEvent) => {
      const set = listeners.get(projectId) ?? new Set<(event: ProjectEvent) => void>()
      set.add(onEvent)
      listeners.set(projectId, set)
      return Promise.resolve(() => {
        unsubscribeCount += 1
        set.delete(onEvent)
        return Promise.resolve()
      })
    },
  }
}

/** publish が必ず失敗する publisher。**失敗しても本処理が止まらない**ことの確認に使う。 */
export const createFailingProjectEventPublisher = (
  message = '配信に失敗しました',
): ProjectEventPublisher & { readonly attempts: () => number } => {
  let attempts = 0
  return {
    attempts: () => attempts,
    publish: () => {
      attempts += 1
      return Promise.reject(new Error(message))
    },
  }
}
