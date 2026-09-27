import { MediaAssetId, type ProjectId, type ShotId, type Take, type WorkspaceId } from '@ixa/domain'
import { z } from 'zod'
import { WireTake } from '@/lib/api-schemas'
import type { Requester } from '@/lib/requester'
import type { UploadApi } from '@/lib/upload-api'

/**
 * 手持ちの動画を Take にする（ADR-0026）。アップロード済みの動画をそのまま Shot の Take にする。
 * 同じ動画を同じ Shot にもう一度取り込んでも、サーバは既にある Take を返す（増えない）。
 */

/** 空白だけのモデル名は「分からない」（null）にしてから送る。 */
export const ImportTakeBody = z.object({
  mediaAssetId: MediaAssetId,
  sourceModel: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().trim().max(120).nullable(),
  ),
  fileName: z.string().max(255).nullable(),
})
export type ImportTakeBody = z.input<typeof ImportTakeBody>

/** 素材の長さだけを読む。速度の説明に使う（probe がまだなら null）。 */
const WireMediaDuration = z.object({
  probe: z.object({ durationSec: z.number().nonnegative().nullable() }).nullable(),
})

export type FootageApi = {
  importTake: (shotId: ShotId, body: ImportTakeBody) => Promise<Take>
  mediaDurationSec: (mediaAssetId: MediaAssetId) => Promise<number | null>
}

export const createFootageApi = (requester: Requester): FootageApi => ({
  importTake: async (shotId, body) =>
    requester.post(
      `/shots/${encodeURIComponent(shotId)}/takes/import`,
      ImportTakeBody.parse(body),
      WireTake,
    ),
  mediaDurationSec: async (mediaAssetId) =>
    (await requester.get(`/media/${encodeURIComponent(mediaAssetId)}`, WireMediaDuration)).probe
      ?.durationSec ?? null,
})

export type FootageImportApi = Pick<UploadApi, 'uploadMedia'> & Pick<FootageApi, 'importTake'>

export type FootageTarget = {
  readonly shotId: ShotId
  readonly workspaceId: WorkspaceId
  readonly projectId: ProjectId
}

/**
 * 動画を 1 本ずつ上げて、同じ Shot の Take にする。**順に**送る（取り込んだ順が Take の番号になる）。
 * 途中で落ちたら、それまでに取り込んだ分は残る（Take は追記のみ）。
 */
export const importFootageFiles = async (
  api: FootageImportApi,
  target: FootageTarget,
  files: readonly File[],
  sourceModel: string | null,
): Promise<readonly Take[]> => {
  const takes: Take[] = []
  for (const file of files) {
    const asset = await api.uploadMedia(file, {
      workspaceId: target.workspaceId,
      projectId: target.projectId,
      kind: 'video',
    })
    takes.push(await api.importTake(target.shotId, { mediaAssetId: asset.id, sourceModel, fileName: file.name }))
  }
  return takes
}
