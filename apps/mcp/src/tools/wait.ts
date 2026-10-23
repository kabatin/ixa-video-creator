import { z } from 'zod'
import { checkFor, JobRef, projectActivityCheck } from '../lib/job-checks.js'
import { waitForChecks } from '../lib/wait-loop.js'
import { defineTool, Id, jsonResult, ToolInputError, type ToolDeps } from '../tool-def.js'

/** 終わるまで待つ。1 回の呼び出しは `maxWaitSec`（既定 480 秒）で必ず返る。 */

export const DEFAULT_MAX_WAIT_SEC = 480

/**
 * 解像度上げには失敗を知らせる口が無い（API のジョブの状態を引けない）。時間切れのときに次の手を示す。
 */
export const UPSCALE_HINT =
  'Upscale jobs report no failure. If one stays pending, check list_takes for a new take whose reason is ' +
  '"解像度を上げる"; if none appears after a long time, retry upscale_takes for that shot or skip it.'
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
  risk: 'read',
  description:
    'Wait for jobs to finish, polling with backoff. jobs: [{kind:"generation"|"render"|"music"|"sfx"|"analysis"|' +
    '"start_frame"|"review"|"voice", id}] or {kind:"upscale", shotId, takeId}; or projectId to wait until nothing is generating, ' +
    'drawing or rendering in the project. Returns after maxWaitSec (default 480) even if not done ' +
    '(timedOut: true) — just call wait again. Local video generation takes several minutes per take.',
  input: WaitInput,
  handler: async (args, deps) => {
    const outcome = await waitWith(deps, args)
    const upscalePending = outcome.timedOut && outcome.results.some((r) => r.kind === 'upscale' && r.state === 'pending')
    return jsonResult(upscalePending ? { ...outcome, hint: UPSCALE_HINT } : outcome)
  },
})
