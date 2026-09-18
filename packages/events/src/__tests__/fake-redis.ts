import type { RedisLike } from '../redis.js'

export type FakeRedis = RedisLike & {
  readonly publishedTo: () => readonly { readonly channel: string; readonly message: string }[]
  readonly subscribeCalls: () => readonly string[]
  readonly unsubscribeCalls: () => readonly string[]
  readonly quitCount: () => number
  /** Redis から本文が届いたことにする */
  readonly emitMessage: (channel: string, message: string) => void
  /** duplicate() で作られた子。[0] が publisher、[1] が subscriber。 */
  readonly duplicates: () => readonly FakeRedis[]
}

/** 実 Redis には繋がないテスト用の接続。CI で本物を叩かない。 */
export const createFakeRedis = (): FakeRedis => {
  let published: readonly { channel: string; message: string }[] = []
  let subscribed: readonly string[] = []
  let unsubscribed: readonly string[] = []
  let handlers: readonly ((channel: string, message: string) => void)[] = []
  let children: readonly FakeRedis[] = []
  let quits = 0

  return {
    publish: (channel, message) => {
      published = [...published, { channel, message }]
      return Promise.resolve(1)
    },
    subscribe: (channel) => {
      subscribed = [...subscribed, channel]
      return Promise.resolve(subscribed.length)
    },
    unsubscribe: (channel) => {
      unsubscribed = [...unsubscribed, channel]
      return Promise.resolve(0)
    },
    on: (_event, listener) => {
      handlers = [...handlers, listener]
      return undefined
    },
    duplicate: () => {
      const child = createFakeRedis()
      children = [...children, child]
      return child
    },
    quit: () => {
      quits += 1
      return Promise.resolve('OK')
    },
    publishedTo: () => published,
    subscribeCalls: () => subscribed,
    unsubscribeCalls: () => unsubscribed,
    quitCount: () => quits,
    emitMessage: (channel, message) => {
      for (const handler of handlers) handler(channel, message)
    },
    duplicates: () => children,
  }
}
