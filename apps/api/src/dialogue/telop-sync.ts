import { ProjectId as ProjectIdSchema, ShotId as ShotIdSchema, type ProjectId } from '@ixa/domain'
import { syncDialogueTelops, type DialogueTelopSyncDeps } from '@ixa/generation'
import type { ShotRepository } from '@ixa/db'
import type { MiddlewareHandler } from 'hono'
import type { Logger } from 'pino'

/**
 * セリフの字幕（ADR-0061）を、Shot を変える口のあとで作り直す。
 *
 * **口ごとに呼ばない。** Shot のセリフ・採用 Take・Take の音・時刻を変える口は多く（1 件・一括・分割・結合・
 * 絵コンテ・取り消し・粗編集…）、どれかで呼び忘れると字幕が黙って古いまま残る（ADR-0060 の仕上げと同じ理由）。
 * Shot と絵コンテと取り消しの道（下の `SHOT_PATH`・`PROJECT_PATH`）の書き込みが成功したら、作品ごとに 1 回だけ作り直す。
 *
 * - 規則は `@ixa/generation` の `syncDialogueTelops`（worker も同じものを呼ぶ）。中身が同じなら書かない。
 * - **セリフの無い作品は読むだけ**（セリフもセリフの字幕も無ければ書かない）。
 * - 作り直しに失敗しても、元の書き込みは成功のまま返す（ログに残す。次の書き込みで揃う）。
 */

const ULID = '[0-9A-HJKMNP-TV-Z]{26}'
/** Shot 1 件の口（直す・消す・採用・分割・取り込み…）。Shot から作品を引く。 */
const SHOT_PATH = new RegExp(`^/shots/(${ULID})(?:/|$)`)
/** 作品の Shot・絵コンテ・取り消し・タイムライン（粗編集・拍合わせ）の口。 */
const PROJECT_PATH = new RegExp(`^/projects/(${ULID})/(?:shots|storyboard|edit-batches|timeline)(?:/|$)`)

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export type DialogueTelopSync = {
  /** 作り直す。**投げない**（失敗はログに残す）。 */
  readonly sync: (projectId: ProjectId) => Promise<void>
  readonly middleware: MiddlewareHandler
}

export const createDialogueTelopSync = (
  deps: DialogueTelopSyncDeps & { readonly shots: Pick<ShotRepository, 'findById' | 'findByProject'>; readonly logger: Logger },
): DialogueTelopSync => {
  const sync = async (projectId: ProjectId): Promise<void> => {
    try {
      await syncDialogueTelops(deps, projectId)
    } catch (error) {
      deps.logger.error({ err: error, projectId }, 'セリフの字幕を作り直せませんでした（次に Shot を直したときに揃います）')
    }
  }

  /** どの作品の書き込みか。Shot の口は**書く前に**引く（消す口のあとでは Shot が読めない）。 */
  const projectOf = async (path: string): Promise<ProjectId | null> => {
    const project = PROJECT_PATH.exec(path)?.[1]
    if (project !== undefined) return ProjectIdSchema.parse(project)
    const shotId = SHOT_PATH.exec(path)?.[1]
    if (shotId === undefined) return null
    return (await deps.shots.findById(ShotIdSchema.parse(shotId)))?.projectId ?? null
  }

  const middleware: MiddlewareHandler = async (c, next) => {
    if (READ_METHODS.has(c.req.method)) {
      await next()
      return
    }
    const projectId = await projectOf(c.req.path).catch((error: unknown) => {
      deps.logger.error({ err: error, path: c.req.path }, 'セリフの字幕を作り直す作品を引けませんでした')
      return null
    })
    await next()
    if (projectId === null || c.res.status >= 400) return
    await sync(projectId)
  }

  return { sync, middleware }
}
