import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { ProjectRepository } from '@ixa/db'
import {
  ProjectId as ProjectIdSchema,
  type ProjectEvent,
  type ProjectEventSubscriber,
} from '@ixa/domain'
import { streamSSE } from 'hono/streaming'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import type { Logger } from '../logger.js'
import { errorContent, fail } from '../response.js'

/**
 * Project の出来事を SSE で流す経路（tasks/todo.md PHASE 5.8b）。
 * ADR-0006 に従い zod スキーマとハンドラを 1 ファイルに同居させる。
 *
 * 27 件を一括で生成に回したあと、27 件の状態を再読み込みで追うのは無理がある。
 * worker と API が状態を変えた瞬間に流した出来事を、ここで 1 本の接続に載せる。
 *
 * **出来事の形は domain が持つ**（`ProjectEvent`）。配信の手段（Redis / メモリ）は
 * `packages/events` が持つ。ここはその 2 つを HTTP に繋ぐだけで、どちらの中身も知らない。
 */

/**
 * 心拍の間隔。中継機器やリバースプロキシは無通信の接続を落とすため、
 * 何も起きていないことを定期的に伝える。
 */
export const HEARTBEAT_INTERVAL_MS = 15_000

/** 心拍の行。コメント行なので `EventSource` は無視する。 */
export const HEARTBEAT_LINE = ': heartbeat\n\n'

/**
 * 接続直後に 1 行だけ送る出来事。**画面はこれを見て「繋がった」と判断する。**
 * 接続が確立しただけでは何も届かないので、これが無いと「繋がっているが静か」と
 * 「繋がっていない」を区別できない（tasks/lessons.md L-015）。
 */
export const READY_EVENT = 'ready'

const ProjectParams = z.object({
  projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }),
})

/**
 * SSE の本文は zod で表せないため、`content` を持たない 200 として宣言し、
 * 形は description に書く。
 */
const projectEventsRoute = createRoute({
  method: 'get',
  path: '/projects/{projectId}/events',
  tags: ['events'],
  summary: 'Project の出来事を SSE で受け取る',
  description: [
    '`text/event-stream` を返す。行の形は次のとおり。',
    '',
    '- `event: ready` / `data: {"projectId":"..."}` — 接続直後に 1 行だけ。繋がった証拠',
    '- `event: shot.status` / `data: <ProjectEvent の JSON>` / `id: <at>`',
    '- `event: generation_job.status` / `data: <ProjectEvent の JSON>` / `id: <at>`',
    `- \`: heartbeat\` — ${HEARTBEAT_INTERVAL_MS / 1000} 秒ごとのコメント行。中継機器の切断を防ぐ`,
    '',
    '`data` の中身は domain の `ProjectEvent`（`packages/domain/src/events/project-event.ts`）。',
    '',
    '**`Last-Event-ID` は受け取るが、取りこぼしの再送はしない。**',
    '再送には出来事の保存が要り、いまは保存していない。受け取った値はログに残すだけ。',
    '切断中に起きた変化は、画面が ID で引き直して埋める。',
  ].join('\n'),
  request: { params: ProjectParams },
  responses: {
    200: { description: '出来事の流れ（text/event-stream）' },
    404: errorContent('Project が存在しない'),
    422: errorContent('入力の検証に失敗した'),
    500: errorContent('サーバ内部エラー'),
  },
})

export type EventRoutesDeps = {
  projects: ProjectRepository
  events: ProjectEventSubscriber
  logger: Logger
  /**
   * 心拍の間隔。既定は `HEARTBEAT_INTERVAL_MS`。
   * **テストから縮めるために開けてある。** 15 秒待てないと心拍は検証できず、
   * 検証していない心拍は「送っているはず」でしかない。
   */
  heartbeatIntervalMs?: number
}

/** 1 本の接続が持つ後始末。**解除を忘れると接続が漏れる**ので 1 箇所にまとめる。 */
type Connection = {
  /** 購読の解除。何度呼んでも 1 回しか効かない。 */
  readonly release: () => Promise<void>
  /** 解除済みか。心拍の輪を抜ける判断に使う。 */
  readonly isReleased: () => boolean
  /** 解除されるか、指定の時間が過ぎるまで待つ。解除で即座に起きる。 */
  readonly waitOrRelease: (ms: number) => Promise<void>
  /** 購読の解除関数を預ける。預ける前に解除されていたら false を返す。 */
  readonly hold: (unsubscribe: () => Promise<void>) => boolean
}

const createConnection = (logger: Logger, projectId: string): Connection => {
  let unsubscribe: (() => Promise<void>) | null = null
  let released = false
  let wake: (() => void) | null = null

  const release = async (): Promise<void> => {
    if (released) return
    released = true
    wake?.()
    wake = null
    const off = unsubscribe
    unsubscribe = null
    if (off === null) return
    try {
      await off()
    } catch (error) {
      // 解除に失敗しても接続は既に無い。握り潰さず文脈を付けて残す。
      logger.warn({ err: error, projectId }, '出来事の購読を解除できませんでした')
    }
  }

  return {
    release,
    isReleased: () => released,
    waitOrRelease: (ms) =>
      new Promise<void>((resolve) => {
        if (released) {
          resolve()
          return
        }
        const timer = setTimeout(() => {
          wake = null
          resolve()
        }, ms)
        wake = () => {
          clearTimeout(timer)
          resolve()
        }
      }),
    hold: (off) => {
      if (released) return false
      unsubscribe = off
      return true
    },
  }
}

export const eventRoutes = (deps: EventRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(projectEventsRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      // **購読する前に確かめる。** 存在しない Project の接続を抱えても誰も何も流さない。
      if ((await deps.projects.findById(projectId)) === null) {
        return c.json(fail(NOT_FOUND_MESSAGE), 404)
      }

      const lastEventId = c.req.header('Last-Event-ID') ?? null
      if (lastEventId !== null) {
        /**
         * 受け取るが再送はしない。**「再送した」と誤解させないため記録だけ残す**
         * （tasks/lessons.md L-015: 飛ばした処理は痕跡を残す）。
         */
        deps.logger.info(
          { projectId, lastEventId },
          'Last-Event-ID を受け取りましたが、取りこぼしの再送は行いません',
        )
      }

      return streamSSE(c, async (stream) => {
        const connection = createConnection(deps.logger, projectId)

        stream.onAbort(() => {
          void connection.release()
        })
        /**
         * 実行環境によっては切断が `stream` まで伝わらないことがあるため、
         * 要求そのものの中断にも保険をかける。`release` も `abort` も再入は無害。
         */
        c.req.raw.signal.addEventListener('abort', () => {
          stream.abort()
          void connection.release()
        })

        /**
         * 書き込みは直列に並べる。購読の通知は同期の関数で届くので、
         * 待たずに次が来ると行が混ざる。失敗は 1 本の接続の問題なので、
         * ログに残して接続だけを畳む。
         */
        let writes: Promise<void> = Promise.resolve()
        const enqueue = (write: () => Promise<void>): void => {
          writes = writes
            .then(async () => {
              if (connection.isReleased() || stream.aborted || stream.closed) return
              await write()
            })
            .catch(async (error: unknown) => {
              deps.logger.warn({ err: error, projectId }, '出来事を書き出せませんでした')
              await connection.release()
            })
        }

        const onEvent = (event: ProjectEvent): void => {
          enqueue(() =>
            stream.writeSSE({
              event: event.type,
              data: JSON.stringify(event),
              id: event.at,
            }),
          )
        }

        /**
         * 購読そのものが張れないことがある（配信基盤が落ちているなど）。
         * **`ready` を送る前に閉じる。** ここで握り潰して `ready` だけ送ると、
         * 画面は「繋がっているが何も起きていない」と誤解する（tasks/lessons.md L-015）。
         */
        let unsubscribe: () => Promise<void>
        try {
          unsubscribe = await deps.events.subscribe(projectId, onEvent)
        } catch (error) {
          deps.logger.error({ err: error, projectId }, '出来事を購読できませんでした')
          await connection.release()
          return
        }

        // 購読が張られる前に切れていた場合。**ここを飛ばすと購読が残る。**
        if (!connection.hold(unsubscribe)) {
          await unsubscribe()
          return
        }

        enqueue(() =>
          stream.writeSSE({ event: READY_EVENT, data: JSON.stringify({ projectId }) }),
        )

        const heartbeatMs = deps.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS
        while (!connection.isReleased() && !stream.aborted && !stream.closed) {
          await connection.waitOrRelease(heartbeatMs)
          if (connection.isReleased() || stream.aborted || stream.closed) break
          enqueue(() => stream.write(HEARTBEAT_LINE).then(() => undefined))
        }

        await connection.release()
        await writes
      })
    })
