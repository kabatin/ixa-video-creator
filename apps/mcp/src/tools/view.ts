import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { seg, type ApiClient } from '../api-client.js'
import { downloadMedia, extensionFor } from '../lib/media-io.js'
import { assertListed, assertMediaInProject, assertShotsInProject, assertTakesOfShot } from '../lib/project-scope.js'
import { WireMediaAsset, WireRenderJob, WireStartFrame } from '../wire.js'
import { defineTool, Id, ToolInputError, type ToolDeps } from '../tool-def.js'

/**
 * 絵を見る（`view`）。エージェントが出来を自分の目で確かめて、描き直す・作り直すを決められるように、
 * 画像そのものを MCP の image content で返す。応答を小さく保つため幅 ~768px の JPEG に縮める。
 */

export const ViewInput = z.object({
  projectId: Id,
  shotId: Id.optional().describe('Alone: the start frame of this shot. With takeId: that take.'),
  takeId: Id.optional(),
  renderJobId: Id.optional().describe('A finished export.'),
  mediaAssetId: Id.optional().describe('Any image or video media asset.'),
  frames: z.number().int().min(1).max(8).default(3).describe('Frames from a video: 3 = start, middle, end.'),
  width: z.number().int().min(256).max(1280).default(768),
})
type ViewArgs = z.infer<typeof ViewInput>

type Target = { readonly mediaAssetId: string; readonly what: Readonly<Record<string, string>> }

const targetOf = async (api: ApiClient, args: ViewArgs): Promise<Target> => {
  const chosen = [args.renderJobId, args.mediaAssetId, args.shotId].filter((v) => v !== undefined)
  if (chosen.length !== 1) {
    throw new ToolInputError('shotId（+takeId）・renderJobId・mediaAssetId のどれか 1 つを指定してください')
  }
  // 別の作品の絵・動画は取り出さない（素材の URL を引く前に確かめる）。
  if (args.mediaAssetId !== undefined) {
    await assertMediaInProject(api, args.projectId, [args.mediaAssetId])
    return { mediaAssetId: args.mediaAssetId, what: { mediaAssetId: args.mediaAssetId } }
  }
  if (args.renderJobId !== undefined) {
    await assertListed(api, `/projects/${seg(args.projectId)}/renders`, [args.renderJobId], '書き出し')
    const job = await api.get(`/renders/${seg(args.renderJobId)}`, WireRenderJob)
    if (job.outputAssetId === null) throw new ToolInputError(`書き出しはまだ終わっていません（${job.status}）`)
    return { mediaAssetId: job.outputAssetId, what: { renderJobId: args.renderJobId } }
  }
  const shotId = args.shotId as string
  if (args.takeId !== undefined) {
    const takes = await assertTakesOfShot(api, args.projectId, shotId, [args.takeId])
    const take = takes.find((t) => t.id === args.takeId)
    if (take === undefined) throw new ToolInputError('その Take はこの Shot にありません')
    return { mediaAssetId: take.mediaAssetId, what: { shotId, takeId: take.id } }
  }
  await assertShotsInProject(api, args.projectId, [shotId])
  const frame = await api.get(`/shots/${seg(shotId)}/start-frame`, WireStartFrame)
  if (frame.mediaAssetId === null) {
    throw new ToolInputError('この Shot には最初のコマがありません（draw_start_frames で描く。Take を見るなら takeId も）')
  }
  return { mediaAssetId: frame.mediaAssetId, what: { shotId, startFrame: frame.mediaAssetId } }
}

/** 動画なら最後のコマ（次の Shot の最初のコマに使える。set_start_frame {mediaAssetId}）も読む。 */
const WireViewedMedia = WireMediaAsset.extend({ lastFrameAssetId: z.string().nullable().default(null) })

const render = async (deps: ToolDeps, args: ViewArgs, target: Target, dir: string): Promise<CallToolResult> => {
  const info = await deps.api.get(`/media/${seg(target.mediaAssetId)}`, WireViewedMedia)
  const file = await downloadMedia(deps.api, target.mediaAssetId, join(dir, `source${extensionFor(info.mimeType)}`))
  const isVideo = info.kind === 'video' || info.mimeType.startsWith('video/')
  const frames = isVideo
    ? await deps.frames.fromVideo(file.path, args.frames, args.width)
    : [await deps.frames.fromImage(file.path, args.width)]
  const summary = {
    ...target.what,
    kind: isVideo ? 'video' : 'image',
    frames: frames.map((f) => (f.atSec === null ? 'image' : `${String(f.atSec)}s`)),
    ...(isVideo && info.lastFrameAssetId !== null ? { lastFrameAssetId: info.lastFrameAssetId } : {}),
  }
  return {
    content: [
      { type: 'text', text: JSON.stringify(summary) },
      ...frames.map((f) => ({ type: 'image' as const, data: f.jpeg.toString('base64'), mimeType: 'image/jpeg' })),
    ],
  }
}

export const viewTool = defineTool({
  name: 'view',
  risk: 'read',
  description:
    "Look at the actual pictures to judge quality: a shot's start frame ({shotId}), frames of a take " +
    '({shotId, takeId}; default 3 frames = start/middle/end), an export ({renderJobId}) or any media asset. ' +
    'Returns small JPEG images. Check faces, hands, text, continuity and whether it matches the description. ' +
    'Videos also return lastFrameAssetId (usable as the next shot\'s start frame via set_start_frame).',
  input: ViewInput,
  handler: async (args, deps) => {
    const target = await targetOf(deps.api, args)
    const dir = await mkdtemp(join(tmpdir(), 'ixa-mcp-view-'))
    try {
      return await render(deps, args, target, dir)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
})
