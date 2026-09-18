import type { ProjectEvent } from '@ixa/domain'
import { describe, expect, it, vi } from 'vitest'
import { createMemoryProjectEvents } from '../memory.js'
import { PROJECT_A, PROJECT_B, brokenEvent, jobStatusEvent, shotStatusEvent } from './fixtures.js'

describe('createMemoryProjectEvents', () => {
  it('購読した Project の出来事を受け取る', async () => {
    const events = createMemoryProjectEvents()
    const received: ProjectEvent[] = []
    await events.subscriber.subscribe(PROJECT_A, (event) => received.push(event))

    await events.publisher.publish(shotStatusEvent())

    expect(received).toEqual([shotStatusEvent()])
  })

  it('別の Project の出来事は届かない', async () => {
    const events = createMemoryProjectEvents()
    const received: ProjectEvent[] = []
    await events.subscriber.subscribe(PROJECT_A, (event) => received.push(event))

    await events.publisher.publish(shotStatusEvent(PROJECT_B))

    expect(received).toEqual([])
  })

  it('同じ Project を複数が購読すれば全員に配る', async () => {
    const events = createMemoryProjectEvents()
    const first: ProjectEvent[] = []
    const second: ProjectEvent[] = []
    await events.subscriber.subscribe(PROJECT_A, (event) => first.push(event))
    await events.subscriber.subscribe(PROJECT_A, (event) => second.push(event))

    await events.publisher.publish(jobStatusEvent())

    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
  })

  it('解除したら届かなくなる', async () => {
    const events = createMemoryProjectEvents()
    const received: ProjectEvent[] = []
    const release = await events.subscriber.subscribe(PROJECT_A, (event) => received.push(event))

    await release()
    await events.publisher.publish(shotStatusEvent())

    expect(received).toEqual([])
  })

  it('1 人が解除しても、残った購読者には届き続ける', async () => {
    const events = createMemoryProjectEvents()
    const staying: ProjectEvent[] = []
    const leavingRelease = await events.subscriber.subscribe(PROJECT_A, () => undefined)
    await events.subscriber.subscribe(PROJECT_A, (event) => staying.push(event))

    await leavingRelease()
    await events.publisher.publish(shotStatusEvent())

    expect(staying).toHaveLength(1)
  })

  it('解除を 2 回呼んでも壊れない', async () => {
    const events = createMemoryProjectEvents()
    const release = await events.subscriber.subscribe(PROJECT_A, () => undefined)

    await release()
    await expect(release()).resolves.toBeUndefined()
  })

  it('publish は同期的に配る（Promise を待つ前に届いている）', async () => {
    const events = createMemoryProjectEvents()
    const received: ProjectEvent[] = []
    await events.subscriber.subscribe(PROJECT_A, (event) => received.push(event))

    const pending = events.publisher.publish(shotStatusEvent())
    expect(received).toHaveLength(1)
    await pending
  })

  it('壊れた出来事は流さずに投げる', async () => {
    const events = createMemoryProjectEvents()
    const received: ProjectEvent[] = []
    await events.subscriber.subscribe(PROJECT_A, (event) => received.push(event))

    await expect(events.publisher.publish(brokenEvent())).rejects.toThrow()
    expect(received).toEqual([])
  })

  it('受け手が投げても他の受け手への配信を止めず、失敗をログに残す', async () => {
    const warn = vi.fn()
    const events = createMemoryProjectEvents({ logger: { warn } })
    const received: ProjectEvent[] = []
    await events.subscriber.subscribe(PROJECT_A, () => {
      throw new Error('受け手が壊れた')
    })
    await events.subscriber.subscribe(PROJECT_A, (event) => received.push(event))

    await events.publisher.publish(shotStatusEvent())

    expect(received).toHaveLength(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ reason: '受け手が壊れた' })
  })

  it('close したあとは配信されない', async () => {
    const events = createMemoryProjectEvents()
    const received: ProjectEvent[] = []
    await events.subscriber.subscribe(PROJECT_A, (event) => received.push(event))

    await events.close()
    await events.publisher.publish(shotStatusEvent())

    expect(received).toEqual([])
  })
})
