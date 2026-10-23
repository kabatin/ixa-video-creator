import { basename, isAbsolute } from 'node:path'
import { z } from 'zod'
import { seg } from '../api-client.js'
import { uploadLocalFile } from '../lib/media-io.js'
import { assertShotsInProject } from '../lib/project-scope.js'
import { WireTake } from '../wire.js'
import { defineTool, Id, jsonResult } from '../tool-def.js'

/** 手持ちの動画を Shot の Take にする（ADR-0026）。上げ方は upload_music と同じ 2 段階。採用はしない。 */

export const importTakeTool = defineTool({
  name: 'import_take',
  risk: 'write',
  description:
    'Import a local video file (mp4/mov) as a new take of a shot (not selected; use adopt_take). ' +
    'Not allowed while the shot is generating. Importing the same video twice returns the existing take.',
  input: z.object({
    projectId: Id,
    shotId: Id,
    filePath: z.string().min(1).refine(isAbsolute, 'absolute path required'),
    sourceModel: z.string().trim().min(1).max(120).optional().describe('Which model made the video, if known.'),
  }),
  handler: async (args, { api, workspaceId }) => {
    await assertShotsInProject(api, args.projectId, [args.shotId])
    const mediaAssetId = await uploadLocalFile(api, args.filePath, { workspaceId, projectId: args.projectId, kind: 'video' })
    const take = await api.post(
      `/shots/${seg(args.shotId)}/takes/import`,
      { mediaAssetId, sourceModel: args.sourceModel ?? null, fileName: basename(args.filePath).slice(0, 255) },
      WireTake,
    )
    return jsonResult({ shotId: args.shotId, takeId: take.id, index: take.index, durationSec: take.spec.durationSec, mediaAssetId })
  },
})
