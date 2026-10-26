import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { renderExportFileName, renderExportFolderName, RenderPreset, Seconds } from '@ixa/domain'
import { z } from 'zod'
import { IxaApiError, seg, type ApiClient } from '../api-client.js'
import { checkFor } from '../lib/job-checks.js'
import { downloadMedia } from '../lib/media-io.js'
import { assertListed, assertShotsInProject } from '../lib/project-scope.js'
import { waitForChecks } from '../lib/wait-loop.js'
import { WireProject, WireRenderJob } from '../wire.js'
import { defineTool, Id, jsonResult, ToolInputError, type ToolDeps } from '../tool-def.js'
import { MAX_WAIT_SEC } from './wait.js'

/** 書き出し（全編を 1 本の動画に）と、出来た動画を手元のフォルダへ取り出す。 */

export const ExportInput = z.object({
  projectId: Id,
  renderJobId: Id.optional().describe('Check / download an existing export instead of starting a new one.'),
  preset: RenderPreset.default('master_1080p'),
  scope: z
    .enum(['full', 'range', 'shots'])
    .default('full')
    .describe('full: whole project; range: startSec..endSec; shots: from the first to the last of shotIds (with everything between).'),
  startSec: Seconds.optional().describe('With scope "range".'),
  endSec: Seconds.positive().optional().describe('With scope "range".'),
  shotIds: z.array(Id).min(1).max(200).optional().describe('With scope "shots".'),
  normalizeLoudness: z
    .boolean()
    .default(true)
    .describe('Apply the final mastering chosen by the project masteringMode (see update_project). false skips it.'),
  force: z.boolean().default(false).describe('Render again even if nothing changed since the last successful export.'),
  waitSec: z.number().int().min(0).max(MAX_WAIT_SEC).default(0).describe('Wait up to this long for the render.'),
  download: z.boolean().default(true).describe('When finished, save the mp4 under IXA_MCP_OUTPUT_DIR.'),
})
type ExportArgs = z.infer<typeof ExportInput>

const WireRenderStarted = z.object({
  renderJobId: z.string(),
  warnings: z.array(z.object({ severity: z.string(), code: z.string(), message: z.string() })),
})

const DuplicateBody = z.object({ duplicateOf: z.object({ renderJobId: z.string() }) })

type WireScope = { readonly type: 'full' } | { readonly type: 'range'; readonly start: number; readonly end: number }

/**
 * 書き出す範囲。API は Shot 単位を受けない（区間で足りる）ので、Shot は最初の頭から最後の終わりまでの区間にする。
 */
export const scopeOf = async (api: ApiClient, args: ExportArgs): Promise<WireScope> => {
  if (args.scope === 'full') return { type: 'full' }
  if (args.scope === 'range') {
    if (args.startSec === undefined || args.endSec === undefined || args.endSec <= args.startSec) {
      throw new ToolInputError('scope "range" には startSec < endSec を指定してください')
    }
    return { type: 'range', start: args.startSec, end: args.endSec }
  }
  const wanted = new Set(args.shotIds ?? [])
  if (wanted.size === 0) throw new ToolInputError('scope "shots" には shotIds を指定してください')
  const shots = (await assertShotsInProject(api, args.projectId, [...wanted])).filter((s) => wanted.has(s.id))
  return {
    type: 'range',
    start: Math.min(...shots.map((s) => s.startSec)),
    end: Math.max(...shots.map((s) => s.startSec + s.durationSec)),
  }
}

type Started = { readonly renderJobId: string; readonly warnings: readonly unknown[]; readonly reusedPrevious: boolean }

/** 新しく書き出す。前回と中身が同じ（409）なら、前回の書き出しを使う。 */
const start = async (api: ApiClient, args: ExportArgs): Promise<Started> => {
  try {
    const started = await api.post(
      `/projects/${seg(args.projectId)}/render`,
      { preset: args.preset, scope: await scopeOf(api, args), normalizeLoudness: args.normalizeLoudness, force: args.force },
      WireRenderStarted,
    )
    return { renderJobId: started.renderJobId, warnings: started.warnings, reusedPrevious: false }
  } catch (error) {
    if (error instanceof IxaApiError && error.status === 409) {
      const duplicate = DuplicateBody.safeParse(error.body)
      if (duplicate.success) {
        return { renderJobId: duplicate.data.duplicateOf.renderJobId, warnings: [], reusedPrevious: true }
      }
    }
    throw error
  }
}

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  )

const saveOutput = async (deps: ToolDeps, projectId: string, job: z.infer<typeof WireRenderJob>): Promise<string> => {
  const project = await deps.api.get(`/projects/${seg(projectId)}`, WireProject)
  const fileName = renderExportFileName({
    projectName: project.name,
    createdAt: new Date(job.createdAt),
    preset: job.preset,
    scope: job.scope,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
  const path = join(deps.outputDir, renderExportFolderName(project.name), fileName)
  if (await exists(path)) return path
  return (await downloadMedia(deps.api, job.outputAssetId as string, path)).path
}

export const exportTool = defineTool({
  name: 'export',
  risk: 'costly',
  description:
    'Render the project (selected takes on the music) to one video: the whole project, a time range or a span of shots. Starts a render (or reuses the previous ' +
    'one if nothing changed, unless force), optionally waits up to waitSec, and when finished saves the mp4 locally ' +
    'and returns filePath. Without waiting, call export again with {renderJobId} (or wait {kind:"render"}). ' +
    'Shots without a selected take are reported in warnings.',
  input: ExportInput,
  handler: async (args, deps) => {
    // 別の作品の書き出しを ID だけで読ませない・落とさせない。
    if (args.renderJobId !== undefined) {
      await assertListed(deps.api, `/projects/${seg(args.projectId)}/renders`, [args.renderJobId], '書き出し')
    }
    const started: Started =
      args.renderJobId === undefined
        ? await start(deps.api, args)
        : { renderJobId: args.renderJobId, warnings: [], reusedPrevious: false }
    if (args.waitSec > 0) {
      await waitForChecks([checkFor(deps.api, { kind: 'render', id: started.renderJobId })], deps.clock, {
        maxWaitSec: args.waitSec,
      })
    }
    const job = await deps.api.get(`/renders/${seg(started.renderJobId)}`, WireRenderJob)
    const filePath =
      job.status === 'succeeded' && job.outputAssetId !== null && args.download
        ? await saveOutput(deps, args.projectId, job)
        : null
    return jsonResult({
      renderJobId: job.id,
      status: job.status,
      progress: Math.round((job.progress ?? 0) * 100) / 100,
      ...(started.reusedPrevious ? { reusedPrevious: true } : {}),
      ...(started.warnings.length > 0 ? { warnings: started.warnings } : {}),
      ...(job.error === null ? {} : { error: job.error }),
      ...(job.outputAssetId === null ? {} : { outputAssetId: job.outputAssetId }),
      ...(filePath === null ? {} : { filePath }),
    })
  },
})
