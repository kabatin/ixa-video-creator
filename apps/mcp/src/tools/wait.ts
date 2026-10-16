import { z } from 'zod'
import { checkFor, JobRef, projectActivityCheck } from '../lib/job-checks.js'
import { waitForChecks } from '../lib/wait-loop.js'
import { defineTool, Id, jsonResult, ToolInputError, type ToolDeps } from '../tool-def.js'

/** 終わるまで待つ。1 回の呼び出しは `maxWaitSec`（既定 480 秒）で必ず返る。 */

export const DEFAULT_MAX_WAIT_SEC = 480
export const MAX_WAIT_SEC = 900

export const WaitInput = z.object({
  jobs: z.array(JobRef).min(1).max(200).optional(),
  projectId: Id.optional().describe('Wait until nothing is generating/drawing/rendering in this project.'),
  maxWaitSec: z.number().int().min(1).max(MAX_WAIT_SEC).default(DEFAULT_MAX_WAIT_SEC),
})

export const waitWith = (deps: ToolDeps, args: z.infer<typeof WaitInput>) => {
  if ((args.jobs === undefined) === (args.projectId === undefined)) {
    throw new ToolInputError('jobs か projectId のどちらか一方を指定してください')
  }
  const checks =
    args.jobs === undefined
      ? [projectActivityCheck(deps.api, args.projectId as string)]
      : args.jobs.map((ref) => checkFor(deps.api, ref))
  const progress = deps.progress
  return waitForChecks(checks, deps.clock, {
    maxWaitSec: args.maxWaitSec,
    ...(progress === undefined
      ? {}
      : { onProgress: (done: number, total: number) => progress(done, total, `${String(done)}/${String(total)} finished`) }),
  })
}

export const waitTool = defineTool({
  name: 'wait',
  description:
    'Wait for jobs to finish, polling with backoff. jobs: [{kind:"generation"|"render"|"music"|"analysis"|' +
    '"start_frame", id}] or {kind:"upscale", shotId, takeId}; or projectId to wait until nothing is generating, ' +
    'drawing or rendering in the project. Returns after maxWaitSec (default 480) even if not done ' +
    '(timedOut: true) — just call wait again. Local video generation takes several minutes per take.',
  input: WaitInput,
  handler: async (args, deps) => jsonResult(await waitWith(deps, args)),
})
