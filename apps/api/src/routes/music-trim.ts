import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { EditBatchRepository, MusicTrackRepository, ProjectRepository, ShotRepository } from '@ixa/db'
import {
  EditBatchId as EditBatchIdSchema,
  MusicTrack as MusicTrackSchema,
  ProjectId as ProjectIdSchema,
  pickMasterTrack,
  shotEndSec,
  trimMusicPatch,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, ok, successResponse } from '../response.js'

/**
 * 曲を最後の Shot で切る（制作者 2026-10-19「カットの合計尺より音楽が長いと最後に黒画面が出来てしまう。
 * カットより長い部分は楽曲をカットするとか？」）。
 *
 * ```
 * POST /projects/{projectId}/music-tracks/trim-to-shots
 * ```
 *
 * 鳴らしている曲（マスター）の終わりを最後の Shot の終わりにし、フェードアウトが 0 なら 0.5 秒にする
 * （`trimMusicPatch`）。押した瞬間に変わるので、**変える前を記録して取り消せるようにする**（`music_trim`）。
 */

export const NO_MASTER_TRACK_MESSAGE = '鳴らしている曲がありません'
export const NO_SHOTS_MESSAGE = 'Shot が無いので、どこで切るか決められません'

const ProjectParams = z.object({
  projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }),
})

const TrimMusicResult = z
  .object({
    track: MusicTrackSchema,
    /** 取り消しに使う記録。何も変わらなかったときは null（記録を作らない）。 */
    editBatchId: EditBatchIdSchema.nullable(),
  })
  .openapi('TrimMusicToShotsResult')

const trimRoute = createRoute({
  method: 'post',
  path: '/projects/{projectId}/music-tracks/trim-to-shots',
  tags: ['music'],
  summary: '鳴らしている曲を最後の Shot の終わりで切る（取り消せる）',
  request: { params: ProjectParams },
  responses: {
    200: { description: '切ったあとの曲', content: { 'application/json': { schema: successResponse(TrimMusicResult) } } },
    404: errorContent('Project が存在しない'),
    409: errorContent('曲が無い / Shot が無い'),
    500: errorContent('サーバ内部エラー'),
  },
})

export type MusicTrimRoutesDeps = {
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly shots: Pick<ShotRepository, 'findByProject'>
  readonly musicTracks: Pick<MusicTrackRepository, 'findByProject' | 'update'>
  readonly editBatches: Pick<EditBatchRepository, 'create'>
}

export const musicTrimRoutes = (deps: MusicTrimRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook }).openapi(trimRoute, async (c) => {
    const { projectId } = c.req.valid('param')
    if ((await deps.projects.findById(projectId)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)

    const [tracks, shots] = await Promise.all([
      deps.musicTracks.findByProject(projectId),
      deps.shots.findByProject(projectId),
    ])
    // 切るのはタイムラインで鳴らしている 1 曲（`loadTimelineSource` と同じ選び方）。
    const master = pickMasterTrack(tracks)
    if (master === null) return c.json(fail(NO_MASTER_TRACK_MESSAGE), 409)
    if (shots.length === 0) return c.json(fail(NO_SHOTS_MESSAGE), 409)

    const lastShotEndSec = Math.max(...shots.map(shotEndSec))
    const patch = trimMusicPatch(master, lastShotEndSec)
    const before = { endSec: master.endSec ?? null, fadeOutSec: master.fadeOutSec ?? 0 }
    const unchanged = before.endSec === patch.endSec && patch.fadeOutSec === undefined
    if (unchanged) return c.json(ok({ track: master, editBatchId: null }), 200)

    // 記録は書く前に作る（書いた後だと、記録に失敗したとき戻せない変更だけが残る）。
    const batch = await deps.editBatches.create({
      projectId,
      kind: 'music_trim',
      summary: `曲「${master.title}」を最後の Shot の終わりで切りました`,
      entries: [],
      musicEntries: [{ musicTrackId: master.id, ...before }],
    })
    const updated = await deps.musicTracks.update(master.id, patch)
    if (updated === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
    return c.json(ok({ track: updated, editBatchId: batch.id }), 200)
  })
