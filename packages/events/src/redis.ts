import { ProjectEvent } from '@ixa/domain'
import IORedis from 'ioredis'
import { projectEventChannel } from './channel.js'
import { decodeProjectEvent } from './decode.js'
import type { ProjectEvents } from './project-events.js'
import { createReporter, type ProjectEventsLogging } from './report.js'
import { createSubscriptionHub } from './subscription.js'

/**
 * この層が Redis に求めるものだけを書き出した口。
 * ioredis の `Redis` はこれを構造的に満たすので、呼び出し側はそのまま渡せる。
 * テストは素のオブジェクトを渡せばよく、モジュールのモックが要らない。
 */
export type RedisLike = {
  readonly publish: (channel: string, message: string) => Promise<unknown>
  readonly subscribe: (channel: string) => Promise<unknown>
  readonly unsubscribe: (channel: string) => Promise<unknown>
  readonly on: (
    event: 'message',
    listener: (channel: string, message: string) => void,
  ) => unknown
  readonly duplicate: () => RedisLike
  readonly quit: () => Promise<unknown>
}

export type RedisProjectEventsOptions = ProjectEventsLogging &
  (
    | { readonly url: string; readonly connection?: undefined }
    /** 既にある接続（BullMQ 用など）。**閉じない。** ここから複製を 2 本取る。 */
    | { readonly connection: RedisLike; readonly url?: undefined }
  )

type Clients = {
  readonly publisher: RedisLike
  readonly subscriber: RedisLike
}

/**
 * **購読用は必ず別接続。** SUBSCRIBE 中の接続では他のコマンドを打てないため、
 * 同じ接続を使うと PUBLISH がエラーになる。
 *
 * 渡された接続は複製してから使う。こうすると「自分が作った接続だけを close で閉じる」が
 * 常に成り立ち、呼び出し側の接続を巻き添えで切ることがない。
 */
const createClients = (options: RedisProjectEventsOptions): Clients => {
  if (options.connection !== undefined) {
    return {
      publisher: options.connection.duplicate(),
      subscriber: options.connection.duplicate(),
    }
  }
  return {
    publisher: new IORedis(options.url),
    subscriber: new IORedis(options.url),
  }
}

/**
 * Redis pub/sub で出来事を流す版。
 *
 * 接続を張るのはこの関数の中だけ。import しただけでは何も起きない（CLAUDE.md 規約 7b）。
 */
export const createRedisProjectEvents = (options: RedisProjectEventsOptions): ProjectEvents => {
  const reporter = createReporter(options)
  const clients = createClients(options)

  const hub = createSubscriptionHub(
    {
      attach: async (channel) => {
        await clients.subscriber.subscribe(channel)
      },
      detach: async (channel) => {
        await clients.subscriber.unsubscribe(channel)
      },
    },
    reporter,
  )

  clients.subscriber.on('message', (channel, message) => {
    const decoded = decodeProjectEvent(message)
    if (!decoded.ok) {
      // 読めない本文を黙って捨てない（lessons L-015）。購読者が 0 人でも必ず報告する。
      reporter.invalid({ channel, raw: message, reason: decoded.reason })
      return
    }
    hub.deliver(channel, decoded.event)
  })

  const publish = async (event: ProjectEvent): Promise<void> => {
    // 壊れた物を流さない。受け手は形を信じて描き換えるので、入口で止めるしかない。
    // ここでは投げてよい。握るのは呼び出し側（worker / API）の責務。
    const validated = ProjectEvent.parse(event)
    await clients.publisher.publish(
      projectEventChannel(validated.projectId),
      JSON.stringify(validated),
    )
  }

  const close = async (): Promise<void> => {
    hub.clear()
    await Promise.all([clients.publisher.quit(), clients.subscriber.quit()])
  }

  return { publisher: { publish }, subscriber: hub.subscriber, close }
}
