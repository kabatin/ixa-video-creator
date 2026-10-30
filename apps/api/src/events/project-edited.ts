import {
  MusicTrackId,
  NarrationLineId,
  ProjectEditOrigin,
  ProjectId as ProjectIdSchema,
  SequenceId,
  ShotId,
  TakeId,
  TimelineClipId,
  TransitionId,
  type ProjectEventPublisher,
  type ProjectId,
} from '@ixa/domain'
import type {
  MusicTrackRepository,
  NarrationLineRepository,
  SequenceRepository,
  ShotRepository,
  TakeRepository,
  TimelineClipRepository,
  TransitionRepository,
} from '@ixa/db'
import type { MiddlewareHandler } from 'hono'
import type { Logger } from 'pino'

/**
 * 作品を書き換える口の成功のあとに `project.edited` を流す（2026-10-30）。
 *
 * 画面を開いたまま MCP の `edit_clips`（→ `PATCH /clips/{id}`）でテロップの縁の色を変えても、画面は読み直すまで
 * 古いままだった（制作者の報告）。出来事を流していたのはジョブの状態だけで、テロップ・効果音・Shot・
 * 最初のフレーム・ナレーションなどの書き込みは何も流していなかった。
 *
 * **口ごとに流さない。** 書き込みの口は 100 を超え、どれかで流し忘れると、その操作だけが黙って画面に出ない
 * （`dialogue/telop-sync.ts` と同じ理由）。読む以外の要求が成功したら、作品を引いて 1 件流す。
 *
 * - 書いた画面の印（`X-Ixa-Client`）を `origin` に載せる。画面は自分の書き込みを読み直さない（自分で反映済み）
 * - 1 件ずつの口は**書く前に**作品を引く（消す口のあとでは行が読めない）
 * - 流すのに失敗しても、元の書き込みは成功のまま返す（ログに残す。規約 5）
 */

const ULID = '[0-9A-HJKMNP-TV-Z]{26}'
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
export const PROJECT_EDIT_ORIGIN_HEADER = 'x-ixa-client'

const PROJECT_PATH = new RegExp(`^/projects/(${ULID})(?:/|$)`)

export type ProjectEditedDeps = {
  readonly events: ProjectEventPublisher
  readonly shots: Pick<ShotRepository, 'findById'>
  readonly takes: Pick<TakeRepository, 'findById'>
  readonly timelineClips: Pick<TimelineClipRepository, 'findById'>
  readonly transitions: Pick<TransitionRepository, 'findById'>
  readonly sequences: Pick<SequenceRepository, 'findById'>
  readonly musicTracks: Pick<MusicTrackRepository, 'findById'>
  /** ナレーションの口を置かない構成では無い。 */
  readonly narrationLines?: Pick<NarrationLineRepository, 'findById'>
  readonly now: () => Date
  readonly logger: Logger
}

type Lookup = (id: string) => Promise<ProjectId | null>

/** 1 件の口（`/<名前>/<ID>`）から作品を引く表。**作品に属する行を持つ口はここに足す。** */
const lookups = (deps: ProjectEditedDeps): ReadonlyMap<string, Lookup> => {
  const shotProject: Lookup = async (id) => (await deps.shots.findById(ShotId.parse(id)))?.projectId ?? null
  const entries: ReadonlyArray<readonly [string, Lookup]> = [
    ['shots', shotProject],
    ['clips', async (id) => (await deps.timelineClips.findById(TimelineClipId.parse(id)))?.projectId ?? null],
    ['transitions', async (id) => (await deps.transitions.findById(TransitionId.parse(id)))?.projectId ?? null],
    ['sequences', async (id) => (await deps.sequences.findById(SequenceId.parse(id)))?.projectId ?? null],
    ['music-tracks', async (id) => (await deps.musicTracks.findById(MusicTrackId.parse(id)))?.projectId ?? null],
    [
      'takes',
      async (id) => {
        const take = await deps.takes.findById(TakeId.parse(id), { includeHidden: true })
        return take === null ? null : await shotProject(take.shotId)
      },
    ],
  ]
  const lines = deps.narrationLines
  const narration: ReadonlyArray<readonly [string, Lookup]> =
    lines === undefined
      ? []
      : [['narration-lines', async (id) => (await lines.findById(NarrationLineId.parse(id)))?.projectId ?? null]]
  return new Map([...entries, ...narration])
}

const ITEM_PATH = new RegExp(`^/([a-z-]+)/(${ULID})(?:/|$)`)

export const createProjectEditedNotifier = (deps: ProjectEditedDeps): MiddlewareHandler => {
  const byResource = lookups(deps)

  const projectOf = async (path: string): Promise<ProjectId | null> => {
    const project = PROJECT_PATH.exec(path)?.[1]
    if (project !== undefined) return ProjectIdSchema.parse(project)
    const item = ITEM_PATH.exec(path)
    const lookup = item?.[1] === undefined ? undefined : byResource.get(item[1])
    if (lookup === undefined || item?.[2] === undefined) return null
    return await lookup(item[2])
  }

  return async (c, next) => {
    if (READ_METHODS.has(c.req.method)) {
      await next()
      return
    }
    const projectId = await projectOf(c.req.path).catch((error: unknown) => {
      deps.logger.error({ err: error, path: c.req.path }, '書き換えを知らせる作品を引けませんでした')
      return null
    })
    await next()
    if (projectId === null || c.res.status >= 400) return
    const origin = ProjectEditOrigin.safeParse(c.req.header(PROJECT_EDIT_ORIGIN_HEADER))
    try {
      await deps.events.publish({
        type: 'project.edited',
        projectId,
        at: deps.now().toISOString(),
        origin: origin.success ? origin.data : null,
      })
    } catch (error) {
      deps.logger.error({ err: error, projectId }, '作品の書き換えを画面へ知らせられませんでした（画面は読み直すまで古いままです）')
    }
  }
}
