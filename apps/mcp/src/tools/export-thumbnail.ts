import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { MediaAssetId, TextFont, ThumbnailLayoutInput, ThumbnailSpec, renderExportFolderName, type ThumbnailBackground } from '@ixa/domain'
import { z } from 'zod'
import { seg, type ApiClient } from '../api-client.js'
import { pickCandidate, startKeyArt, waitForKeyArt, type KeyArtCandidate } from '../lib/key-art-candidates.js'
import { downloadMedia } from '../lib/media-io.js'
import { waitForChecks, type CheckResult } from '../lib/wait-loop.js'
import { WireProject, WireThumbnail } from '../wire.js'
import { defineTool, Id, jsonResult, ToolInputError, type ToolDeps } from '../tool-def.js'
import { MAX_WAIT_SEC } from './wait.js'

/**
 * YouTube のサムネイルを書き出す（ADR-0051）。背景はタイムラインのコマ・素材の画像・AI に描かせた絵（キーアート）。
 * 出来た JPEG を手元へ保存し、**画像としても返す**（エージェントが出来を自分の目で見て、描き直しを決められるように）。
 */

const DEFAULT_WAIT_SEC = 180

export const ExportThumbnailInput = z.object({
  projectId: Id,
  thumbnailId: Id.optional().describe('Check / download an existing thumbnail instead of starting a new one.'),
  background: z
    .object({
      atSec: z.number().finite().nonnegative().optional().describe('A frame of the timeline at this second.'),
      mediaAssetId: Id.optional().describe('An image media asset (e.g. a start frame or a previous key art candidate).'),
      keyArt: z
        .object({
          instruction: z.string().max(500).optional().describe('Free-text wish for the AI key visual.'),
          jobIds: z.array(Id).min(1).optional().describe('Resume waiting for candidates from a previous call.'),
        })
        .optional()
        .describe('Let the AI draw 2 key visual candidates (faces large, room for the title on the left).'),
    })
    .optional()
    .describe('Exactly one of atSec / mediaAssetId / keyArt. Required unless thumbnailId.'),
  candidateIndex: z.number().int().min(0).default(0).describe('Which finished key art candidate to use (0-based).'),
  title: z.string().optional().describe('Big title, 1-40 characters. Required unless thumbnailId.'),
  subtitle: z.string().optional().describe('Smaller line, up to 60 characters.'),
  layout: ThumbnailLayoutInput.optional().describe(
    'Where the text block goes on a 3x3 grid: top_/middle_/bottom_ + left/center/right (default middle_left). ' +
      'middle_left / middle_right = a column in the left / right third, middle_center = big in the middle, ' +
      'top_* / bottom_* = a wide band at the top / bottom. Old values left / center / bottom still work.',
  ),
  titleSize: z.number().optional().describe('Title size, integer 28-200. Omit for automatic (largest that fits). Shrinks only if it does not fit.'),
  subtitleSize: z.number().optional().describe('Subtitle size, integer 20-120. Omit for automatic (at most half the title).'),
  accentBar: z.boolean().optional().describe('false = no accent line / band at all (default true).'),
  colors: z
    .object({ title: z.string().optional(), subtitle: z.string().optional(), accent: z.string().optional() })
    .optional()
    .describe('#RRGGBB colors for the title, the subtitle and the accent bar.'),
  font: TextFont.optional(),
  zoom: z.number().optional().describe('1-2. Zoom into the background.'),
  focusX: z.number().optional().describe('0-1. Which part of the background to keep (0.5 = center).'),
  focusY: z.number().optional(),
  waitSec: z.number().int().min(0).max(MAX_WAIT_SEC).default(DEFAULT_WAIT_SEC).describe('Wait up to this long in total.'),
})
type ExportThumbnailArgs = z.infer<typeof ExportThumbnailInput>

/** 背景を除いた仕様を組み、API に送る前に domain の規則で確かめる（直せる誤りは往復させない）。 */
const specOf = (args: ExportThumbnailArgs, background: ThumbnailBackground): ThumbnailSpec => {
  const parsed = ThumbnailSpec.safeParse({
    background,
    title: args.title ?? '',
    ...(args.subtitle === undefined ? {} : { subtitle: args.subtitle }),
    ...(args.layout === undefined ? {} : { layout: args.layout }),
    ...(args.titleSize === undefined ? {} : { titleSize: args.titleSize }),
    ...(args.subtitleSize === undefined ? {} : { subtitleSize: args.subtitleSize }),
    ...(args.accentBar === undefined ? {} : { accentBar: args.accentBar }),
    ...(args.colors?.title === undefined ? {} : { titleColor: args.colors.title }),
    ...(args.colors?.subtitle === undefined ? {} : { subtitleColor: args.colors.subtitle }),
    ...(args.colors?.accent === undefined ? {} : { accentColor: args.colors.accent }),
    ...(args.font === undefined ? {} : { font: args.font }),
    ...(args.zoom === undefined ? {} : { zoom: args.zoom }),
    ...(args.focusX === undefined ? {} : { focusX: args.focusX }),
    ...(args.focusY === undefined ? {} : { focusY: args.focusY }),
  })
  if (!parsed.success) {
    throw new ToolInputError(
      `サムネイルの指定が不正です — ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' / ')}`,
    )
  }
  return parsed.data
}

type BackgroundChoice =
  | { readonly kind: 'ready'; readonly background: ThumbnailBackground; readonly candidates: readonly KeyArtCandidate[] | null }
  | { readonly kind: 'waiting'; readonly candidates: readonly KeyArtCandidate[] }

const chooseBackground = async (
  deps: ToolDeps,
  args: ExportThumbnailArgs,
  waitSec: number,
): Promise<BackgroundChoice> => {
  const given = args.background ?? {}
  const chosen = [given.atSec, given.mediaAssetId, given.keyArt].filter((value) => value !== undefined)
  if (chosen.length !== 1) throw new ToolInputError('background は atSec・mediaAssetId・keyArt のどれか 1 つを指定してください')
  if (given.atSec !== undefined) return { kind: 'ready', background: { kind: 'timeline_frame', atSec: given.atSec }, candidates: null }
  if (given.mediaAssetId !== undefined) {
    return { kind: 'ready', background: { kind: 'image', mediaAssetId: MediaAssetId.parse(given.mediaAssetId) }, candidates: null }
  }
  const keyArt = given.keyArt ?? {}
  const jobIds = keyArt.jobIds ?? (await startKeyArt(deps.api, args.projectId, keyArt.instruction))
  const outcome = await waitForKeyArt(deps.api, args.projectId, jobIds, deps.clock, waitSec)
  if (outcome.timedOut) return { kind: 'waiting', candidates: outcome.candidates }
  const mediaAssetId = pickCandidate(outcome.candidates, args.candidateIndex)
  return { kind: 'ready', background: { kind: 'image', mediaAssetId: MediaAssetId.parse(mediaAssetId) }, candidates: outcome.candidates }
}

const thumbnailCheck = (api: ApiClient, id: string) => ({
  label: { kind: 'thumbnail', id },
  poll: async (): Promise<CheckResult> => {
    const row = await api.get(`/thumbnails/${seg(id)}`, WireThumbnail)
    if (row.status === 'done') return { state: 'succeeded', detail: {} }
    if (row.status === 'failed') return { state: 'failed', detail: { error: row.error } }
    return { state: 'pending', detail: { status: row.status } }
  },
})

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  )

/** 書き出しフォルダと同じ形（`<作品名>/<ファイル名>`）で手元へ置く。もうあれば落とし直さない。 */
const saveOutput = async (deps: ToolDeps, projectId: string, row: WireThumbnail & { outputAssetId: string }): Promise<string> => {
  const project = await deps.api.get(`/projects/${seg(projectId)}`, WireProject)
  const path = join(deps.outputDir, renderExportFolderName(project.name), row.fileName)
  if (await exists(path)) return path
  return (await downloadMedia(deps.api, row.outputAssetId, path)).path
}

const candidateSummary = (candidates: readonly KeyArtCandidate[] | null) =>
  candidates === null
    ? {}
    : {
        keyArtJobIds: candidates.map((candidate) => candidate.jobId),
        keyArtCandidates: candidates.flatMap((candidate) => (candidate.mediaAssetId === null ? [] : [candidate.mediaAssetId])),
      }

const finish = async (
  deps: ToolDeps,
  args: ExportThumbnailArgs,
  thumbnailId: string,
  candidates: readonly KeyArtCandidate[] | null,
  remainingSec: number,
): Promise<CallToolResult> => {
  if (remainingSec > 0) {
    await waitForChecks([thumbnailCheck(deps.api, thumbnailId)], deps.clock, { maxWaitSec: remainingSec })
  }
  const row = await deps.api.get(`/thumbnails/${seg(thumbnailId)}`, WireThumbnail)
  const base = { thumbnailId, status: row.status, fileName: row.fileName, ...candidateSummary(candidates) }
  if (row.status === 'failed') return jsonResult({ ...base, error: row.error })
  if (row.status !== 'done' || row.outputAssetId === null) return jsonResult({ ...base, timedOut: true })
  const filePath = await saveOutput(deps, args.projectId, { ...row, outputAssetId: row.outputAssetId })
  const jpeg = await readFile(filePath)
  return {
    content: [
      { type: 'text', text: JSON.stringify({ ...base, outputAssetId: row.outputAssetId, filePath }) },
      { type: 'image', data: jpeg.toString('base64'), mimeType: 'image/jpeg' },
    ],
  }
}

export const exportThumbnailTool = defineTool({
  name: 'export_thumbnail',
  risk: 'costly',
  description:
    'Make a YouTube thumbnail (1280x720 JPEG under 2 MB) with a big title. Background: a timeline frame {atSec}, ' +
    'an image {mediaAssetId}, or {keyArt:{instruction?}} which draws 2 AI candidates and uses candidateIndex (default 0). ' +
    'Waits up to waitSec in total, saves the JPEG under IXA_MCP_OUTPUT_DIR and returns filePath plus the image so you ' +
    'can judge it. keyArtCandidates lists every candidate mediaAssetId: retry with {mediaAssetId} to use another one. ' +
    'On timedOut call again with {thumbnailId} (or keyArt.jobIds) to keep waiting.',
  input: ExportThumbnailInput,
  handler: async (args, deps) => {
    const startedAt = deps.clock.now()
    const remaining = (): number => Math.max(0, args.waitSec - Math.floor((deps.clock.now() - startedAt) / 1000))
    if (args.thumbnailId !== undefined) return finish(deps, args, args.thumbnailId, null, remaining())

    // 背景を決める前（キーアートを頼む前）に、題名や色の誤りを断る。背景は仮の値で確かめる。
    specOf(args, { kind: 'timeline_frame', atSec: 0 })
    const choice = await chooseBackground(deps, args, remaining())
    if (choice.kind === 'waiting') {
      return jsonResult({ status: 'drawing_background', timedOut: true, ...candidateSummary(choice.candidates) })
    }
    const spec = specOf(args, choice.background)
    const started = await deps.api.post(
      `/projects/${seg(args.projectId)}/thumbnails`,
      { spec },
      z.object({ thumbnailId: z.string() }),
    )
    return finish(deps, args, started.thumbnailId, choice.candidates, remaining())
  },
})
