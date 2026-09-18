import type { ProjectEvent } from '@ixa/domain'
import { describe, expect, it, vi } from 'vitest'
import { projectEventChannel } from '../channel.js'
import { createRedisProjectEvents, type RedisProjectEventsOptions } from '../redis.js'
import { createFakeRedis, type FakeRedis } from './fake-redis.js'
import { PROJECT_A, PROJECT_B, brokenEvent, jobStatusEvent, shotStatusEvent } from './fixtures.js'

const CHANNEL_A = projectEventChannel(PROJECT_A)

type Harness = {
  readonly events: ReturnType<typeof createRedisProjectEvents>
  readonly publisher: FakeRedis
  readonly subscriber: FakeRedis
}

const harness = (options: Omit<RedisProjectEventsOptions, 'connection' | 'url'> = {}): Harness => {
  const connection = createFakeRedis()
  const events = createRedisProjectEvents({ ...options, connection })
  const [publisher, subscriber] = connection.duplicates()
  if (!publisher || !subscriber) throw new Error('複製が 2 本作られていない')
  return { events, publisher, subscriber }
}

describe('createRedisProjectEvents — 接続', () => {
  it('publish 用と購読用に別々の接続を持つ（SUBSCRIBE 中は他のコマンドを打てないため）', () => {
    const connection = createFakeRedis()
    createRedisProjectEvents({ connection })

    expect(connection.duplicates()).toHaveLength(2)
  })

  it('作っただけでは SUBSCRIBE しない', () => {
    const { subscriber } = harness()

    expect(subscriber.subscribeCalls()).toEqual([])
  })

  it('close で自分が作った接続を両方閉じ、渡された接続は閉じない', async () => {
    const connection = createFakeRedis()
    const events = createRedisProjectEvents({ connection })
    const [publisher, subscriber] = connection.duplicates()

    await events.close()

    expect(publisher?.quitCount()).toBe(1)
    expect(subscriber?.quitCount()).toBe(1)
    expect(connection.quitCount()).toBe(0)
  })
})

describe('createRedisProjectEvents — publish', () => {
  it('Project のチャンネルへ JSON を PUBLISH する', async () => {
    const { events, publisher } = harness()
    const event = jobStatusEvent()

    await events.publisher.publish(event)

    const sent = publisher.publishedTo()
    expect(sent).toHaveLength(1)
    expect(sent[0]?.channel).toBe(CHANNEL_A)
    // 本文は JSON。キーの並びは zod の検証を通ると変わるので、戻した値で比べる。
    expect(JSON.parse(sent[0]?.message ?? '')).toEqual(event)
  })

  it('購読用の接続へは PUBLISH しない', async () => {
    const { events, subscriber } = harness()

    await events.publisher.publish(shotStatusEvent())

    expect(subscriber.publishedTo()).toEqual([])
  })

  it('壊れた出来事は検証で弾き、Redis へ送らない', async () => {
    const { events, publisher } = harness()

    await expect(events.publisher.publish(brokenEvent())).rejects.toThrow()
    expect(publisher.publishedTo()).toEqual([])
  })
})

describe('createRedisProjectEvents — 参照カウント', () => {
  it('1 人目で SUBSCRIBE する', async () => {
    const { events, subscriber } = harness()

    await events.subscriber.subscribe(PROJECT_A, () => undefined)

    expect(subscriber.subscribeCalls()).toEqual([CHANNEL_A])
  })

  it('2 人目では SUBSCRIBE を重ねない', async () => {
    const { events, subscriber } = harness()

    await events.subscriber.subscribe(PROJECT_A, () => undefined)
    await events.subscriber.subscribe(PROJECT_A, () => undefined)

    expect(subscriber.subscribeCalls()).toEqual([CHANNEL_A])
  })

  it('Project が違えばそれぞれ SUBSCRIBE する', async () => {
    const { events, subscriber } = harness()

    await events.subscriber.subscribe(PROJECT_A, () => undefined)
    await events.subscriber.subscribe(PROJECT_B, () => undefined)

    expect(subscriber.subscribeCalls()).toEqual([CHANNEL_A, projectEventChannel(PROJECT_B)])
  })

  it('最後の 1 人が解除するまで UNSUBSCRIBE しない', async () => {
    const { events, subscriber } = harness()
    const first = await events.subscriber.subscribe(PROJECT_A, () => undefined)
    const second = await events.subscriber.subscribe(PROJECT_A, () => undefined)

    await first()
    expect(subscriber.unsubscribeCalls()).toEqual([])

    await second()
    expect(subscriber.unsubscribeCalls()).toEqual([CHANNEL_A])
  })

  it('同じ関数を 2 回渡しても 2 人として数える', async () => {
    const { events, subscriber } = harness()
    const onEvent = (): void => undefined
    const first = await events.subscriber.subscribe(PROJECT_A, onEvent)
    await events.subscriber.subscribe(PROJECT_A, onEvent)

    await first()

    expect(subscriber.unsubscribeCalls()).toEqual([])
  })

  it('解除を 2 回呼んでも UNSUBSCRIBE は 1 回だけ（残った購読者を巻き添えにしない）', async () => {
    const { events, subscriber } = harness()
    const first = await events.subscriber.subscribe(PROJECT_A, () => undefined)
    await events.subscriber.subscribe(PROJECT_A, () => undefined)

    await first()
    await first()

    expect(subscriber.unsubscribeCalls()).toEqual([])
  })

  it('解除したあとに同じ Project を購読すれば、また SUBSCRIBE する', async () => {
    const { events, subscriber } = harness()
    const release = await events.subscriber.subscribe(PROJECT_A, () => undefined)
    await release()

    await events.subscriber.subscribe(PROJECT_A, () => undefined)

    expect(subscriber.subscribeCalls()).toEqual([CHANNEL_A, CHANNEL_A])
  })
})

describe('createRedisProjectEvents — 受信', () => {
  it('受けた本文を出来事に戻して購読者へ配る', async () => {
    const { events, subscriber } = harness()
    const received: ProjectEvent[] = []
    await events.subscriber.subscribe(PROJECT_A, (event) => received.push(event))

    subscriber.emitMessage(CHANNEL_A, JSON.stringify(jobStatusEvent()))

    expect(received).toEqual([jobStatusEvent()])
  })

  it('解除したあとは届かない', async () => {
    const { events, subscriber } = harness()
    const received: ProjectEvent[] = []
    const release = await events.subscriber.subscribe(PROJECT_A, (event) => received.push(event))

    await release()
    subscriber.emitMessage(CHANNEL_A, JSON.stringify(shotStatusEvent()))

    expect(received).toEqual([])
  })

  it('読めない本文は捨てずに onInvalid へ渡す', async () => {
    const onInvalid = vi.fn()
    const { events, subscriber } = harness({ onInvalid })
    const received: ProjectEvent[] = []
    await events.subscriber.subscribe(PROJECT_A, (event) => received.push(event))

    subscriber.emitMessage(CHANNEL_A, 'これは JSON ではない')

    expect(received).toEqual([])
    expect(onInvalid).toHaveBeenCalledTimes(1)
    expect(onInvalid.mock.calls[0]?.[0]).toMatchObject({
      channel: CHANNEL_A,
      raw: 'これは JSON ではない',
      reason: 'JSON として読めない',
    })
  })

  it('形が合わない出来事も onInvalid へ渡す', () => {
    const onInvalid = vi.fn()
    const { subscriber } = harness({ onInvalid })

    subscriber.emitMessage(CHANNEL_A, JSON.stringify(brokenEvent()))

    expect(onInvalid).toHaveBeenCalledTimes(1)
  })

  it('購読者が 0 人でも、読めない本文は報告する', () => {
    const onInvalid = vi.fn()
    const { subscriber } = harness({ onInvalid })

    subscriber.emitMessage(CHANNEL_A, '{}')

    expect(onInvalid).toHaveBeenCalledTimes(1)
  })

  it('onInvalid が無ければログへ回し、本文そのものは載せない', () => {
    const warn = vi.fn()
    const { subscriber } = harness({ logger: { warn } })

    subscriber.emitMessage(CHANNEL_A, '{"projectId":"signed-url-かもしれない本文"}')

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).not.toHaveProperty('raw')
    expect(JSON.stringify(warn.mock.calls[0])).not.toContain('signed-url')
  })
})
