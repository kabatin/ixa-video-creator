import { MAX_PLAYBACK_RATE, MIN_PLAYBACK_RATE } from '@ixa/domain'
import { z } from 'zod'
import { seg } from '../api-client.js'
import {
  boundariesFrom,
  boundaryProblem,
  plannedShots,
  snapBoundaries,
  type PlanInput,
} from '../lib/shot-planning.js'
import { WireModel, WireShot } from '../wire.js'
import { fetchAnalysis, resolveTrackId } from './music.js'
import { defineTool, Id, jsonResult, round, ToolInputError } from '../tool-def.js'

/** Shot 割り（カット点 → Shot）。 */

const Seconds = z.number().min(0)

export const PlanShotsInput = z.object({
  projectId: Id,
  boundariesSec: z
    .array(Seconds)
    .min(2)
    .max(200)
    .optional()
    .describe('Cut points in seconds, ascending, including the first shot start and the last shot end.'),
  durationsSec: z
    .array(z.number().positive())
    .min(1)
    .max(199)
    .optional()
    .describe('Alternative to boundariesSec: shot lengths laid end to end from startSec.'),
  startSec: Seconds.default(0),
  snap: z
    .enum(['none', 'downbeat', 'beat'])
    .default('none')
    .describe('Move each cut to the nearest bar start (downbeat) or beat of the master track.'),
  maxShiftSec: z.number().positive().max(4).default(1).describe('A cut never moves further than this when snapping.'),
  model: z
    .string()
    .min(1)
    .optional()
    .describe('Video model id (see ixa_status) to report the length each shot will be generated at.'),
  speed: z
    .number()
    .min(MIN_PLAYBACK_RATE)
    .max(MAX_PLAYBACK_RATE)
    .default(1)
    .describe(
      'Planned playback speed, only used to report generateSec (= durationSec × speed rounded up). ' +
        'Short cuts are fine: a 1.2 s cut is generated at the model minimum and trimmed. Set the speed with edit_shots.',
    ),
  musicTrackId: Id.optional(),
  codePrefix: z.string().regex(/^[A-Za-z0-9]{1,16}$/).optional().describe('Shot code prefix, default CUT.'),
  dryRun: z.boolean().default(false).describe('Only compute the plan, create nothing.'),
})

const inputOf = (args: z.infer<typeof PlanShotsInput>): PlanInput => {
  if ((args.boundariesSec === undefined) === (args.durationsSec === undefined)) {
    throw new ToolInputError('boundariesSec か durationsSec のどちらか一方を指定してください')
  }
  return args.boundariesSec !== undefined
    ? { kind: 'cuts', boundariesSec: args.boundariesSec }
    : { kind: 'durations', startSec: args.startSec, durationsSec: args.durationsSec ?? [] }
}

export const planShotsTool = defineTool({
  name: 'plan_shots',
  risk: 'write',
  description:
    'Create shots from cut points (appended after existing shots; must not overlap them). Give boundariesSec ' +
    '(absolute cut times incl. start and end) or durationsSec. snap="downbeat" aligns cuts to bar starts of the master ' +
    'track. Video model lengths matter: local vpipe MiniMax H3 makes 17n+5 frames at 24 fps, i.e. 2.333…10.125 s ' +
    '(n=3..14); a shot longer than the model maximum is generated at the maximum and slowed down (up to 1.5x), longer ' +
    'than that is rejected — split it. Pass model to see the generated length per shot. Use dryRun to preview.',
  input: PlanShotsInput,
  handler: async (args, { api }) => {
    const raw = boundariesFrom(inputOf(args))
    const problem = boundaryProblem(raw)
    if (problem !== null) throw new ToolInputError(problem)

    const snapped =
      args.snap === 'none'
        ? { boundariesSec: raw, dropped: [] as readonly number[] }
        : await (async () => {
            const trackId = await resolveTrackId(api, args.projectId, args.musicTrackId)
            const { analysis } = await fetchAnalysis(api, trackId)
            if (analysis === null) throw new ToolInputError('曲の解析がまだありません（wait {kind:"analysis"} の後で）')
            return snapBoundaries(raw, args.snap === 'downbeat' ? analysis.downbeats : analysis.beats, args.maxShiftSec)
          })()
    const afterSnap = boundaryProblem(snapped.boundariesSec)
    if (afterSnap !== null) throw new ToolInputError(`寄せた結果: ${afterSnap}`)

    const support =
      args.model === undefined
        ? null
        : await (async () => {
            const models = await api.get('/models', z.array(WireModel))
            const found = models.find((m) => m.id === args.model)
            if (found === undefined) throw new ToolInputError(`model ${args.model ?? ''} はありません（ixa_status の videoModels）`)
            return found.durations
          })()

    const plan = plannedShots(snapped.boundariesSec, support, args.speed)
    const summary = {
      boundariesSec: snapped.boundariesSec,
      ...(snapped.dropped.length > 0 ? { droppedBySnap: snapped.dropped } : {}),
      plan,
    }
    if (args.dryRun) return jsonResult({ dryRun: true, ...summary })

    const created = await api.post(
      `/projects/${seg(args.projectId)}/storyboard/cuts`,
      {
        boundariesSec: snapped.boundariesSec,
        ...(args.codePrefix === undefined ? {} : { codePrefix: args.codePrefix }),
      },
      z.object({ shots: z.array(WireShot), warnings: z.array(z.string()) }),
    )
    return jsonResult({
      ...summary,
      created: created.shots.map((s) => ({
        id: s.id,
        code: s.code,
        startSec: round(s.startSec),
        durationSec: round(s.durationSec),
      })),
      warnings: created.warnings,
    })
  },
})
