import { z } from 'zod'
import { seg, type ApiClient } from '../api-client.js'
import { WireShot } from '../wire.js'
import { defineTool, describeError, Id, jsonResult, mapLimited, ToolInputError } from '../tool-def.js'

/** 待っている・作っている仕事を止める。種類ごとに API の止める口が違うので、ここで振り分ける。 */

export const CancelJobsInput = z.object({
  projectId: Id,
  kind: z.enum(['video', 'image', 'music', 'sfx', 'voice', 'upscale']),
  shotIds: z.array(Id).min(1).max(200).optional().describe('video / image: only these shots. Default: all.'),
  lineIds: z.array(Id).min(1).max(1000).optional().describe('voice: only these narration lines. Default: all.'),
})
type CancelArgs = z.infer<typeof CancelJobsInput>

const Cancelled = z.object({ cancelledJobIds: z.array(z.string()) })

/** 動画は Shot ごとの口しか無い。指定が無ければ生成中の Shot だけを止めに行く。 */
const cancelVideo = async (api: ApiClient, args: CancelArgs) => {
  const shots = await api.get(`/projects/${seg(args.projectId)}/shots`, z.array(WireShot))
  const known = new Set(shots.map((s) => s.id))
  const foreign = (args.shotIds ?? []).filter((id) => !known.has(id))
  if (foreign.length > 0) throw new ToolInputError(`この作品に無い Shot です: ${foreign.join(', ')}`)
  const targets = args.shotIds ?? shots.filter((s) => s.status === 'generating').map((s) => s.id)
  const results = await mapLimited(targets, 4, (shotId) =>
    api.post(`/shots/${seg(shotId)}/generations/cancel`, undefined, Cancelled).then(
      (r) => ({ shotId, ok: true as const, cancelledJobIds: r.cancelledJobIds }),
      (error: unknown) => ({ shotId, ok: false as const, reason: describeError(error) }),
    ),
  )
  const failures = results.flatMap((r) => (r.ok ? [] : [{ shotId: r.shotId, reason: r.reason }]))
  return {
    cancelledJobIds: results.flatMap((r) => (r.ok ? r.cancelledJobIds : [])),
    ...(failures.length > 0 ? { failures } : {}),
  }
}

const projectWide = (path: string) => (api: ApiClient, args: CancelArgs) =>
  api.post(`/projects/${seg(args.projectId)}/${path}`, undefined, Cancelled)

const CANCELLERS = {
  video: cancelVideo,
  image: (api: ApiClient, args: CancelArgs) =>
    api.post(`/projects/${seg(args.projectId)}/images/cancel`, args.shotIds === undefined ? {} : { shotIds: args.shotIds }, Cancelled),
  music: projectWide('music-jobs/cancel'),
  sfx: projectWide('sfx-jobs/cancel'),
  voice: (api: ApiClient, args: CancelArgs) =>
    api.post(`/projects/${seg(args.projectId)}/voice-jobs/cancel`, args.lineIds === undefined ? {} : { lineIds: args.lineIds }, Cancelled),
  upscale: projectWide('upscales/cancel'),
} as const

export const cancelJobsTool = defineTool({
  name: 'cancel_jobs',
  risk: 'destructive',
  description:
    'Stop queued or running jobs of one kind: video (generate_takes; shotIds or every generating shot), image ' +
    '(start frames etc.; shotIds or all), music, sfx, voice (lineIds or all) or upscale. Finished results are kept.',
  input: CancelJobsInput,
  handler: async (args, { api }) => {
    if (args.shotIds !== undefined && args.kind !== 'video' && args.kind !== 'image') {
      throw new ToolInputError('shotIds は video と image のときだけ使えます')
    }
    if (args.lineIds !== undefined && args.kind !== 'voice') throw new ToolInputError('lineIds は voice のときだけ使えます')
    const result = await CANCELLERS[args.kind](api, args)
    return jsonResult({ kind: args.kind, cancelled: result.cancelledJobIds.length, ...result })
  },
})
