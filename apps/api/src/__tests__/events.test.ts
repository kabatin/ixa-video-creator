import { OpenAPIHono } from '@hono/zod-openapi'
import {
  ProjectEvent,
  ShotId as ShotIdSchema,
  newId,
  type Project,
  type ProjectEvent as ProjectEventType,
  type ProjectEventSubscriber,
} from '@ixa/domain'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger, type Logger } from '../logger.js'
import { READY_EVENT, eventRoutes } from '../routes/events.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectEvents } from './in-memory-project-events.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'

/** 心拍を待てる長さに縮める。既定の 15 秒はテストでは待てない。 */
const FAST_HEARTBEAT_MS = 20

/** 行が届くまで待つ上限。届かないまま固まるより、落ちて理由が出るほうがよい。 */
const READ_TIMEOUT_MS = 2000

type LogLine = { readonly msg: string; readonly lastEventId?: string }

/** 出力を配列に溜める logger。「ログに残すだけ」を実際に確かめるために使う。 */
const createRecordingLogger = (): { logger: Logger; lines: () => readonly LogLine[] } => {
  const lines: LogLine[] = []
  const logger = pino(
    { level: 'info' },
    {
      write: (chunk: string) => {
        lines.push(JSON.parse(chunk) as LogLine)
      },
    },
  )
  return { logger, lines: () => lines }
}

type EventsFixtureOptions = {
  readonly project?: Project
  readonly logger?: Logger
  readonly heartbeatIntervalMs?: number
  /** 差し替えると購読が必ず失敗する。配信基盤が落ちている場合の確認に使う。 */
  readonly events?: ProjectEventSubscriber
}

const buildEventsFixture = (options: EventsFixtureOptions = {}) => {
  const project = options.project ?? aProject()
  const events = createInMemoryProjectEvents()
  const app = new OpenAPIHono({ defaultHook: validationHook })
  registerErrorHandlers(app, createLogger('silent'))
  app.route(
    '/',
    eventRoutes({
      projects: createInMemoryProjectRepository([project]),
      events: options.events ?? events,
      logger: options.logger ?? createLogger('silent'),
      heartbeatIntervalMs: options.heartbeatIntervalMs ?? FAST_HEARTBEAT_MS,
    }),
  )
  return { app, project, events }
}

/** SSE の接続を開き、届いた文字を溜めながら条件が満たされるまで待つ。 */
const openStream = async (
  app: OpenAPIHono,
  path: string,
  headers: Record<string, string> = {},
) => {
  const res = await app.request(path, { headers })
  const body = res.body
  if (body === null) throw new Error('SSE の本文がありません')

  // 本文の要素型は環境によって緩くなる。復号する側で明示して `any` を持ち込まない。
  const reader: ReadableStreamDefaultReader<Uint8Array> = body.getReader()
  const decoder = new TextDecoder()
  let received = ''

  const readUntil = async (isDone: (text: string) => boolean): Promise<string> => {
    const deadline = Date.now() + READ_TIMEOUT_MS
    while (!isDone(received)) {
      if (Date.now() > deadline) {
        throw new Error(`期待する行が届きませんでした。受信済み: ${JSON.stringify(received)}`)
      }
      const chunk = await Promise.race([
        reader.read(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 50)),
      ])
      if (chunk === null) continue
      if (chunk.done) break
      received += decoder.decode(chunk.value, { stream: true })
    }
    if (!isDone(received)) {
      throw new Error(`流れが閉じました。受信済み: ${JSON.stringify(received)}`)
    }
    return received
  }

  return { res, reader, readUntil, received: () => received }
}

const contains = (needle: string) => (text: string) => text.includes(needle)

/** 条件が成立するまで少しずつ待つ。解除は接続が畳まれたあとに非同期で起きる。 */
const waitFor = async (condition: () => boolean, label: string): Promise<void> => {
  const deadline = Date.now() + READ_TIMEOUT_MS
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`${label} が成立しませんでした`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const aShotStatusEvent = (project: Project): ProjectEventType =>
  ProjectEvent.parse({
    type: 'shot.status',
    projectId: project.id,
    shotId: newId(ShotIdSchema),
    status: 'generating',
    at: '2026-09-18T10:00:00.000Z',
  })

describe('GET /projects/:projectId/events', () => {
  it('接続直後に ready を 1 行送る（繋がった証拠）', async () => {
    const f = buildEventsFixture()
    const stream = await openStream(f.app, `/projects/${f.project.id}/events`)

    expect(stream.res.status).toBe(200)
    expect(stream.res.headers.get('content-type')).toContain('text/event-stream')

    const text = await stream.readUntil(contains(`event: ${READY_EVENT}`))
    expect(text).toContain(`data: {"projectId":"${f.project.id}"}`)

    await stream.reader.cancel()
  })

  it('publish された出来事を event / data / id で書く', async () => {
    const f = buildEventsFixture()
    const stream = await openStream(f.app, `/projects/${f.project.id}/events`)
    await stream.readUntil(contains(`event: ${READY_EVENT}`))

    const event = aShotStatusEvent(f.project)
    await f.events.publish(event)

    const text = await stream.readUntil(contains('event: shot.status'))
    expect(text).toContain(`data: ${JSON.stringify(event)}`)
    expect(text).toContain(`id: ${event.at}`)

    // 受け取った data がそのまま契約を通ること。形が崩れたらここで落ちる。
    const dataLine = text.split('\n').find((line) => line.startsWith('data: {') && line.includes('"type"'))
    expect(dataLine).toBeDefined()
    expect(() => ProjectEvent.parse(JSON.parse(dataLine?.slice('data: '.length) ?? ''))).not.toThrow()

    await stream.reader.cancel()
  })

  it('他の Project の出来事は流さない', async () => {
    const f = buildEventsFixture()
    const stream = await openStream(f.app, `/projects/${f.project.id}/events`)
    await stream.readUntil(contains(`event: ${READY_EVENT}`))

    await f.events.publish(aShotStatusEvent(aProject()))
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(stream.received()).not.toContain('event: shot.status')

    await stream.reader.cancel()
  })

  /**
   * **接続の漏れを止める見張り。** 解除を忘れると購読が残り続ける。
   *
   * 心拍の間隔をわざと長く取る。短いままだと、心拍の輪が次に回ったときに
   * 抜けて解除されるので、**切断を受けて解除しているのか、輪が回っただけなのかが
   * 区別できない**（tasks/lessons.md L-022）。長くすれば切断の経路しか残らない。
   */
  it('切断したら購読を解除する', async () => {
    const f = buildEventsFixture({ heartbeatIntervalMs: 60_000 })
    const stream = await openStream(f.app, `/projects/${f.project.id}/events`)
    await stream.readUntil(contains(`event: ${READY_EVENT}`))

    expect(f.events.subscriberCount()).toBe(1)

    await stream.reader.cancel()

    await waitFor(() => f.events.unsubscribeCount() === 1, '購読の解除')
    expect(f.events.subscriberCount()).toBe(0)
  })

  it('15 秒ごとの心拍をコメント行で書く', async () => {
    const f = buildEventsFixture({ heartbeatIntervalMs: FAST_HEARTBEAT_MS })
    const stream = await openStream(f.app, `/projects/${f.project.id}/events`)

    await stream.readUntil(contains(': heartbeat'))

    await stream.reader.cancel()
  })

  it('Last-Event-ID は受け取るが再送はしない。受け取ったことはログに残す', async () => {
    const recording = createRecordingLogger()
    const f = buildEventsFixture({ logger: recording.logger })

    const stream = await openStream(f.app, `/projects/${f.project.id}/events`, {
      'Last-Event-ID': '2026-09-18T09:59:00.000Z',
    })
    const text = await stream.readUntil(contains(`event: ${READY_EVENT}`))

    // 再送はしない。ready の他に出来事は来ない
    expect(text).not.toContain('event: shot.status')

    const line = recording.lines().find((l) => l.lastEventId !== undefined)
    expect(line?.lastEventId).toBe('2026-09-18T09:59:00.000Z')
    expect(line?.msg).toContain('再送')

    await stream.reader.cancel()
  })

  it('存在しない Project なら 404 で、購読しない', async () => {
    const f = buildEventsFixture()
    const res = await f.app.request(`/projects/${aProject().id}/events`)

    expect(res.status).toBe(404)
    expect(f.events.subscriberCount()).toBe(0)
  })

  /**
   * **繋がっていないことを「静か」に見せない**（tasks/lessons.md L-015）。
   * 購読が張れないまま ready だけ送ると、画面は最新だと思い込む。
   */
  it('購読が張れなければ ready を送らずに閉じる', async () => {
    const recording = createRecordingLogger()
    const f = buildEventsFixture({
      logger: recording.logger,
      events: { subscribe: () => Promise.reject(new Error('配信基盤に繋がりません')) },
    })

    const res = await f.app.request(`/projects/${f.project.id}/events`)
    const text = await new Response(res.body).text()

    expect(text).not.toContain(`event: ${READY_EVENT}`)
    expect(recording.lines().some((l) => l.msg.includes('購読できませんでした'))).toBe(true)
  })

  it('ProjectId の形が違えば 422', async () => {
    const f = buildEventsFixture()
    const res = await f.app.request('/projects/not-an-ulid/events')

    expect(res.status).toBe(422)
    expect(f.events.subscriberCount()).toBe(0)
  })
})
