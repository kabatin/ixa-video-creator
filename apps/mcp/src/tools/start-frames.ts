import { z } from 'zod'
import { seg } from '../api-client.js'
import { ImageSource, resolveImage } from '../lib/image-source.js'
import { WireShot, WireStartFrameHistory } from '../wire.js'
import { defineTool, Id, jsonResult } from '../tool-def.js'

/**
 * 最初のコマ（動画を作る前の 1 枚）。画像の AI で描くか、手持ちの画像を使う。
 * 描いた絵はチェックされ（ADR-0055）、手元の AI なら自動でやり直す。履歴から選び直せる。
 */

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
    'Each drawing is checked for obvious defects (broken hands/faces, melted objects, garbled text, wrong person, ' +
    'missing main subject); with a local image AI a failed check is redrawn automatically (up to the limit). ' +
    'Then wait with {kind:"start_frame", id: shotId} for each shot (or wait {projectId}); the result carries the ' +
    'check (mark pass/review/retry/unchecked and issues). Use list_start_frame_history / use_start_frame / retry_image.',
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

export const listStartFrameHistoryTool = defineTool({
  name: 'list_start_frame_history',
  description:
    'List every start frame drawn for a shot, oldest first, with its check (mark pass/review/retry/unchecked, issues), ' +
    'whether it is the one in use (current), and the attempt number. View one with view {mediaAssetId}; switch with ' +
    'use_start_frame.',
  input: z.object({ shotId: Id }),
  handler: async ({ shotId }, { api }) => {
    const history = await api.get(`/shots/${seg(shotId)}/start-frame/history`, WireStartFrameHistory)
    const drawn = history.items
      .filter((item) => item.mediaAssetId !== null)
      .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
      .map(({ jobId, attempt, mediaAssetId, current, applied, check }) => ({ jobId, attempt, mediaAssetId, current, applied, check }))
    return jsonResult({ shotId, maxAutoRetries: history.maxRetries, frames: drawn })
  },
})

export const useStartFrameTool = defineTool({
  name: 'use_start_frame',
  description:
    "Switch a shot's start frame to one from its history (jobId from list_start_frame_history). It is recorded as an " +
    'edit, so the user can undo it.',
  input: z.object({ shotId: Id, jobId: Id }),
  handler: async ({ shotId, jobId }, { api }) => {
    const history = await api.get(`/shots/${seg(shotId)}/start-frame/history`, WireStartFrameHistory)
    const chosen = history.items.find((item) => item.jobId === jobId)
    if (chosen?.mediaAssetId === undefined || chosen.mediaAssetId === null) {
      throw new Error(`この Shot の履歴に、絵ができたジョブ ${jobId} がありません（list_start_frame_history で確かめてください）`)
    }
    const saved = await api.request('PUT', `/shots/${seg(shotId)}/start-frame`, z.object({ mediaAssetId: z.string().nullable() }), {
      body: { mediaAssetId: chosen.mediaAssetId },
    })
    return jsonResult({ shotId, mediaAssetId: saved.mediaAssetId, check: chosen.check })
  },
})

export const retryImageTool = defineTool({
  name: 'retry_image',
  description:
    'Redraw an image job (start frame, character sheet or key art) with the same image AI, adding the check\'s fix to ' +
    'the instruction. Use it when a check says retry/review and the image AI did not retry automatically (cloud AIs ' +
    'with usage limits never retry on their own). For a start frame, then wait {kind:"start_frame", id: shotId}.',
  input: z.object({ jobId: Id }),
  handler: async ({ jobId }, { api }) => {
    const started = await api.post(`/image-jobs/${seg(jobId)}/retry`, {}, z.object({ jobId: z.string() }))
    return jsonResult({ retryOf: jobId, jobId: started.jobId })
  },
})
