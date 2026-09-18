import { ProjectId, ShotId, type ProjectEvent } from '@ixa/domain'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROJECT_ID, SHOT_ID } from '@/__tests__/fixtures'
import { RECONNECT_MAX_MS } from '@/lib/project-events'
import { useProjectEvents, type ProjectEventsStatus } from '@/lib/use-project-events'

/**
 * `EventSource` を差し替えて、繋ぎ直しと後始末を確かめる。
 *
 * **後始末は「最終状態」では確かめられない。** 画面を離れたあとに接続が残っていても、
 * 木の中を見ただけでは分からない。`close()` の呼び出しそのものを見張る（lessons L-022）。
 */

const projectId = ProjectId.parse(PROJECT_ID)
const shotId = ShotId.parse(SHOT_ID)
const BASE_URL = 'http://127.0.0.1:3001'

const shotStatusEvent: ProjectEvent = {
  type: 'shot.status',
  projectId,
  at: '2026-09-18T10:00:00.000Z',
  shotId,
  status: 'generating',
}

class FakeEventSource {
  static instances: FakeEventSource[] = []

  readonly close = vi.fn()
  private readonly listeners = new Map<string, Set<(event: Event) => void>>()

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, handler: (event: Event) => void): void {
    const set = this.listeners.get(type) ?? new Set<(event: Event) => void>()
    set.add(handler)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, handler: (event: Event) => void): void {
    this.listeners.get(type)?.delete(handler)
  }

  /** サーバから 1 行届いたことにする。 */
  emit(type: string, data?: string): void {
    for (const handler of this.listeners.get(type) ?? []) {
      handler(new MessageEvent(type, { data }))
    }
  }
}

const latest = (): FakeEventSource => {
  const source = FakeEventSource.instances.at(-1)
  if (source === undefined) throw new Error('EventSource が 1 つも作られていない')
  return source
}

type ProbeProps = {
  readonly seen: ProjectEventsStatus[]
  readonly events: ProjectEvent[]
  readonly enabled?: boolean
}

const Probe = ({ seen, events, enabled }: ProbeProps) => {
  const status = useProjectEvents({
    projectId,
    baseUrl: BASE_URL,
    enabled,
    onEvent: (event) => events.push(event),
  })
  seen.push(status)
  return <output>{status.state}</output>
}

const renderProbe = (enabled?: boolean) => {
  const seen: ProjectEventsStatus[] = []
  const events: ProjectEvent[] = []
  const view = render(<Probe seen={seen} events={events} enabled={enabled} />)
  const last = (): ProjectEventsStatus => {
    const status = seen.at(-1)
    if (status === undefined) throw new Error('まだ 1 度も描画されていない')
    return status
  }
  return { seen, events, view, last }
}

beforeEach(() => {
  FakeEventSource.instances = []
  vi.useFakeTimers()
  vi.stubGlobal('EventSource', FakeEventSource)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useProjectEvents', () => {
  it('最初の描画では繋がない', () => {
    const created: number[] = []
    const Watch = () => {
      created.push(FakeEventSource.instances.length)
      useProjectEvents({ projectId, baseUrl: BASE_URL })
      return null
    }
    render(<Watch />)
    // 1 回目の描画時点では 0 件。サーバに EventSource は無い（lessons L-019）。
    expect(created[0]).toBe(0)
  })

  it('繋ぎに行く先は SSE の経路', () => {
    renderProbe()
    expect(latest().url).toBe(`${BASE_URL}/projects/${PROJECT_ID}/events`)
  })

  it('ready を受けたら live になる', () => {
    const probe = renderProbe()
    expect(probe.last().state).toBe('connecting')

    act(() => {
      latest().emit('ready')
    })

    expect(probe.last().state).toBe('live')
    expect(probe.last().attempt).toBe(0)
  })

  it('出来事を受けたら最終時刻を覚えて呼び出し側へ渡す', () => {
    const probe = renderProbe()
    act(() => {
      latest().emit('ready')
      latest().emit('shot.status', JSON.stringify(shotStatusEvent))
    })

    expect(probe.events).toEqual([shotStatusEvent])
    expect(probe.last().lastEventAt).toBe(shotStatusEvent.at)
  })

  it('読めない data は数える。黙って捨てない', () => {
    const probe = renderProbe()
    act(() => {
      latest().emit('ready')
      latest().emit('shot.status', 'not json')
      latest().emit('shot.status', JSON.stringify({ type: 'shot.status' }))
    })

    expect(probe.last().invalidCount).toBe(2)
    expect(probe.events).toEqual([])
    expect(probe.last().lastEventAt).toBeNull()
  })

  it('error で閉じて reconnecting になり、待ってから繋ぎ直す', () => {
    const probe = renderProbe()
    const first = latest()

    act(() => {
      first.emit('error')
    })

    expect(first.close).toHaveBeenCalledTimes(1)
    expect(probe.last().state).toBe('reconnecting')
    expect(probe.last().attempt).toBe(1)
    // 待ち時間の前に新しい接続を作らない。
    expect(FakeEventSource.instances).toHaveLength(1)

    act(() => {
      vi.advanceTimersByTime(RECONNECT_MAX_MS)
    })

    expect(FakeEventSource.instances).toHaveLength(2)
    expect(latest()).not.toBe(first)
  })

  it('繋ぎ直しの回数を数え、ready で 0 に戻す', () => {
    const probe = renderProbe()

    act(() => {
      latest().emit('error')
    })
    act(() => {
      vi.advanceTimersByTime(RECONNECT_MAX_MS)
    })
    act(() => {
      latest().emit('error')
    })
    expect(probe.last().attempt).toBe(2)

    act(() => {
      vi.advanceTimersByTime(RECONNECT_MAX_MS)
    })
    act(() => {
      latest().emit('ready')
    })
    expect(probe.last().attempt).toBe(0)
    expect(probe.last().state).toBe('live')
  })

  it('画面を離れたら接続を閉じる', () => {
    const probe = renderProbe()
    const source = latest()

    probe.view.unmount()

    expect(source.close).toHaveBeenCalledTimes(1)
  })

  it('画面を離れたら繋ぎ直しのタイマーも消す', () => {
    const probe = renderProbe()
    act(() => {
      latest().emit('error')
    })

    // 待っている間に離れる。
    expect(vi.getTimerCount()).toBe(1)
    probe.view.unmount()

    // **残ったタイマーそのものを見る。** 「新しい接続が作られなかった」では足りない。
    // disposed の見張りに阻まれただけでも同じ結果になり、消し忘れが素通りする（lessons L-022）。
    expect(vi.getTimerCount()).toBe(0)

    vi.advanceTimersByTime(RECONNECT_MAX_MS * 2)
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it('enabled が false なら繋がず stopped', () => {
    const probe = renderProbe(false)
    expect(FakeEventSource.instances).toHaveLength(0)
    expect(probe.last().state).toBe('stopped')
  })

  it('EventSource が無い環境では stopped', () => {
    vi.stubGlobal('EventSource', undefined)
    const probe = renderProbe()
    expect(probe.last().state).toBe('stopped')
  })
})
