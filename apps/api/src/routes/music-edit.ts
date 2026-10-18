import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { DbNotFoundError, type EditTransaction, type MusicTrackRepository } from '@ixa/db'
import {
  EditBatchMusicEntry as EditBatchMusicEntrySchema,
  MusicTrackId as MusicTrackIdSchema,
  UpdateMusicTrackPatch as UpdateMusicTrackPatchSchema,
  type EditBatchMusicEntry,
  type MusicTrack,
  type UpdateMusicTrackPatch,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, listResponse, ok, okList, successResponse } from '../response.js'
import { MusicTrackResponse } from './music.js'

/**
 * 楽曲の欄の直し（題名・開始位置・音量・フェード・曲の終わり）とマスターの切り替え。
 * **どちらも書く前に記録する**（`music_edit`。2026-10-19）。これまで記録が無く、⌘Z で戻らなかった。
 * 記録は変えた欄の、変える前の値だけ（その後に人が直した別の欄は、戻しても残る）。
 */

const MusicTrackParams = z.object({
  id: MusicTrackIdSchema.openapi({ param: { name: 'id', in: 'path' } }),
})

const commonErrors = {
  404: errorContent('対象が存在しない'),
  422: errorContent('入力の検証に失敗した'),
  500: errorContent('サーバ内部エラー'),
}

const updateMusicTrackRoute = createRoute({
  method: 'patch',
  path: '/music-tracks/{id}',
  tags: ['music'],
  summary: '楽曲の題名・オフセット・音量を直す（マスターは set-master で変える）',
  request: {
    params: MusicTrackParams,
    body: { required: true, content: { 'application/json': { schema: UpdateMusicTrackPatchSchema.openapi('UpdateMusicTrackInput') } } },
  },
  responses: {
    200: { description: '更新後の楽曲', content: { 'application/json': { schema: successResponse(MusicTrackResponse) } } },
    ...commonErrors,
  },
})

const setMasterRoute = createRoute({
  method: 'post',
  path: '/music-tracks/{id}/set-master',
  tags: ['music'],
  summary: 'この楽曲をマスターにする（同じ Project の他の楽曲は降格する）',
  request: { params: MusicTrackParams },
  responses: {
    200: { description: 'Project の楽曲一覧（付け替え後）', content: { 'application/json': { schema: listResponse(MusicTrackResponse) } } },
    ...commonErrors,
  },
})

export type MusicEditDeps = {
  readonly musicTracks: Pick<MusicTrackRepository, 'findById' | 'findByProject'>
  /** 記録と書き込みを同じトランザクションで（書き込みが落ちれば記録も残らない）。 */
  readonly transaction: EditTransaction
}

/** 今の値。省かれた欄は既定（フェード 0・曲の終わりは自然な終わり）として比べる。 */
const currentOf = (track: MusicTrack): Required<UpdateMusicTrackPatch> => ({
  title: track.title,
  offsetSec: track.offsetSec,
  volume: track.volume,
  fadeInSec: track.fadeInSec ?? 0,
  fadeOutSec: track.fadeOutSec ?? 0,
  endSec: track.endSec ?? null,
})

/** 直す前の値のうち、**値が変わる欄だけ**。1 つも変わらなければ `null`（記録しない）。 */
export const musicBeforeEntry = (track: MusicTrack, patch: UpdateMusicTrackPatch): EditBatchMusicEntry | null => {
  const current = currentOf(track)
  const changed = (Object.keys(patch) as (keyof UpdateMusicTrackPatch)[]).filter(
    (key) => patch[key] !== undefined && patch[key] !== current[key],
  )
  if (changed.length === 0) return null
  return EditBatchMusicEntrySchema.parse({
    musicTrackId: track.id,
    ...Object.fromEntries(changed.map((key) => [key, current[key]])),
  })
}

/** 書いた結果が無い（途中で消された）なら投げる。トランザクションの中で使い、記録を残さない。 */
const orNotFound = (track: MusicTrack | null, id: MusicTrack['id']): MusicTrack => {
  if (track === null) throw new DbNotFoundError('MusicTrack', id)
  return track
}

export const musicEditRoutes = (deps: MusicEditDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(updateMusicTrackRoute, async (c) => {
      const { id } = c.req.valid('param')
      const track = await deps.musicTracks.findById(id)
      if (track === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const patch = c.req.valid('json')
      const before = musicBeforeEntry(track, patch)
      const updated = await deps.transaction(async (tx) => {
        if (before !== null) {
          await tx.editBatches.create({
            projectId: track.projectId,
            kind: 'music_edit',
            summary: `曲「${track.title}」を直す`,
            entries: [],
            musicEntries: [before],
          })
        }
        // 途中で消されていたら投げて記録ごと巻き戻す（共通ハンドラが 404 にする）。
        return orNotFound(await tx.musicTracks.update(id, patch), id)
      })
      return c.json(ok(updated), 200)
    })
    .openapi(setMasterRoute, async (c) => {
      const { id } = c.req.valid('param')
      const track = await deps.musicTracks.findById(id)
      if (track === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      // 戻すと前のマスターをマスターに戻す。前にマスターが無ければ、この曲を外す口が無いので記録しない。
      const previous = track.isMaster
        ? undefined
        : (await deps.musicTracks.findByProject(track.projectId)).find((each) => each.isMaster)
      const updated = await deps.transaction(async (tx) => {
        if (previous !== undefined) {
          await tx.editBatches.create({
            projectId: track.projectId,
            kind: 'music_edit',
            summary: `マスターを「${track.title}」にする`,
            entries: [],
            musicEntries: [{ musicTrackId: previous.id, master: true }],
          })
        }
        return orNotFound(await tx.musicTracks.setMaster(id), id)
      })
      // 降格した側も画面が持ち直せるよう、Project の全曲を返す。
      return c.json(okList(await deps.musicTracks.findByProject(updated.projectId)), 200)
    })
