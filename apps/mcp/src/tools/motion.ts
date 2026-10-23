import { z } from 'zod'
import { seg, type ApiClient } from '../api-client.js'
import { assertShotsInProject, assertTakesOfShot } from '../lib/project-scope.js'
import { waitForChecks, type CheckResult } from '../lib/wait-loop.js'
import { defineTool, Id, jsonResult } from '../tool-def.js'

/**
 * Take の動きの分析（ADR-0054 の API: apps/api/src/routes/motion-analysis.ts）:
 *
 *   POST /shots/{id}/motion-analysis・/takes/{id}/motion-analysis → 202 { state }（積むだけ）
 *   GET  /shots/{id}/motion-analysis → 採用中の Take の結果（タイムラインの秒）と効果音のきっかけの案
 *   GET  /takes/{id}/motion-analysis → Take の秒の結果
 *
 * 分析済みなら worker は作り直さない（結果を使い回す）。
 */

export const DEFAULT_MOTION_WAIT_SEC = 240
const MAX_MOTION_WAIT_SEC = 600

export const AnalyzeMotionInput = z.object({
  projectId: Id,
  shotId: Id.describe('Without takeId: analyze the adopted take of this shot. Results are in timeline seconds.'),
  takeId: Id.optional().describe('Analyze this take of the shot instead. Results are in take seconds.'),
  maxWaitSec: z.number().int().min(1).max(MAX_MOTION_WAIT_SEC).default(DEFAULT_MOTION_WAIT_SEC),
})

const WireState = z.object({ state: z.enum(['none', 'queued', 'running', 'succeeded', 'failed']) }).passthrough()
type WireState = z.infer<typeof WireState>

const RETRY_HINT = 'Not finished yet. Call analyze_motion again with the same id (it will not re-queue a running analysis).'

/** 分析を積む前に、Shot（と Take）がこの作品のものか確かめる。Take だけでは作品を引けないので Shot と組で受ける。 */
const pathOf = async (api: ApiClient, args: z.infer<typeof AnalyzeMotionInput>): Promise<string> => {
  if (args.takeId === undefined) {
    await assertShotsInProject(api, args.projectId, [args.shotId])
    return `/shots/${seg(args.shotId)}/motion-analysis`
  }
  await assertTakesOfShot(api, args.projectId, args.shotId, [args.takeId])
  return `/takes/${seg(args.takeId)}/motion-analysis`
}

/** 読んだ本文は detail に載せて返す（待ちの結果からそのまま取り出す）。 */
const checkOf = (api: ApiClient, path: string) => async (): Promise<CheckResult> => {
  const body = await api.get(path, WireState)
  if (body.state === 'succeeded' || body.state === 'failed') return { state: body.state, detail: { body } }
  return { state: 'pending', detail: { body } }
}

/** 出来事の案をきっかけの形だけにする（generate_sfx の cues にそのまま渡せる）。 */
const cuesOf = (body: WireState): unknown[] => {
  const suggestions = (body as { suggestions?: unknown }).suggestions
  return Array.isArray(suggestions)
    ? suggestions.flatMap((s: unknown) => (typeof s === 'object' && s !== null && 'cue' in s ? [s.cue] : []))
    : []
}

export const analyzeMotionTool = defineTool({
  name: 'analyze_motion',
  risk: 'costly',
  description:
    'Analyze what happens in a take (motion strength peaks + Claude looking at the frames) and return timed events ' +
    '(moment: impacts, landings, footsteps; sustained: skids, engines, splashes; pass_by: whooshes; ambient) and ' +
    'sound-effect cue ideas. Pass shotId (adopted take, timeline seconds — use this before generate_sfx), or shotId ' +
    'and takeId (take seconds). Queues the analysis if needed and waits up to maxWaitSec (default 240; one analysis takes ' +
    'tens of seconds); results are cached per take. Edit the returned cues (prompt/volume/time) and pass them to ' +
    'generate_sfx.',
  input: AnalyzeMotionInput,
  handler: async (args, deps) => {
    const path = await pathOf(deps.api, args)
    await deps.api.post(path, undefined, WireState)
    const outcome = await waitForChecks([{ label: {}, poll: checkOf(deps.api, path) }], deps.clock, {
      maxWaitSec: args.maxWaitSec,
    })
    const parsed = WireState.safeParse(outcome.results[0]?.body)
    const body: WireState = parsed.success ? parsed.data : { state: 'queued' }
    return jsonResult({
      ...body,
      ...(args.takeId === undefined ? { cues: cuesOf(body) } : {}),
      timedOut: outcome.timedOut,
      ...(outcome.timedOut ? { hint: RETRY_HINT } : {}),
    })
  },
})
