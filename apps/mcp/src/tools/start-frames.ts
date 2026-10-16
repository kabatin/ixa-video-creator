import { z } from 'zod'
import { seg } from '../api-client.js'
import { ImageSource, resolveImage } from '../lib/image-source.js'
import { WireShot } from '../wire.js'
import { defineTool, Id, jsonResult } from '../tool-def.js'

/** 最初のコマ（動画を作る前の 1 枚）。画像の AI で描くか、手持ちの画像を使う。 */

const WireDrawStarted = z.object({
  jobIds: z.array(z.string()),
  skipped: z.object({ drawing: z.number(), hasFrame: z.number() }),
})

export const drawStartFramesTool = defineTool({
  name: 'draw_start_frames',
  description:
    'Draw the start frame (first still image) of shots with the selected image AI, using description, camera, cast ' +
    'and location. The video is then generated from this frame, so check it with view before generate_takes. ' +
    'onlyMissing=true skips shots that already have one; set false to redraw. Shots already drawing are skipped. ' +
    'Then wait with {kind:"start_frame", id: shotId} for each shot (or wait {projectId}).',
  input: z.object({
    projectId: Id,
    shotIds: z.array(Id).min(1).max(100),
    onlyMissing: z.boolean().default(true),
  }),
  handler: async ({ projectId, shotIds, onlyMissing }, { api }) => {
    const started = await api.post(
      `/projects/${seg(projectId)}/start-frames/generate`,
      { shotIds, onlyMissing },
      WireDrawStarted,
    )
    return jsonResult({
      started: started.jobIds.length,
      skipped: started.skipped,
      next: { tool: 'wait', jobs: shotIds.map((id) => ({ kind: 'start_frame', id })) },
    })
  },
})

export const setStartFrameTool = defineTool({
  name: 'set_start_frame',
  description:
    "Use an existing image as a shot's start frame: a media asset id, another shot's start frame " +
    '(for visual continuity) or a local image file.',
  input: ImageSource.extend({ shotId: Id }),
  handler: async ({ shotId, ...source }, { api, workspaceId }) => {
    const shot = await api.get(`/shots/${seg(shotId)}`, WireShot.extend({ projectId: z.string() }))
    const mediaAssetId = await resolveImage(api, source, { workspaceId, projectId: shot.projectId })
    const saved = await api.request('PUT', `/shots/${seg(shotId)}/start-frame`, z.object({ mediaAssetId: z.string().nullable() }), {
      body: { mediaAssetId },
    })
    return jsonResult({ shotId, mediaAssetId: saved.mediaAssetId })
  },
})
