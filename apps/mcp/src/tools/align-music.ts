import { z } from 'zod'
import { seg, type ApiClient } from '../api-client.js'
import { WireShot } from '../wire.js'
import { defineTool, Id, jsonResult, round, ToolInputError } from '../tool-def.js'

/**
 * 曲に合わせた粗編集（PHASE 6.3）。境目の拍からのズレと検証の指摘を見る・粗編集の案を作る・案を当てる・
 * 曲を最後の Shot で切る。当てる口と曲を切る口は取り消しの履歴に残る。
 */

/** 粗編集の 1 件（形の正は packages/timeline の RoughCutChange。MCP は timeline に依存しないので写す）。 */
const RoughCutChange = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('move'),
    shotId: Id,
    fromSec: z.number().finite().nonnegative(),
    toSec: z.number().finite().nonnegative(),
    reason: z.string().min(1),
  }),
  z.object({
    kind: z.literal('trim'),
    shotId: Id,
    fromDurationSec: z.number().finite().positive(),
    toDurationSec: z.number().finite().positive(),
    reason: z.string().min(1),
  }),
  z.object({ kind: z.literal('select'), shotId: Id, takeId: Id, reason: z.string().min(1) }),
])

const WireIssue = z.object({
  severity: z.enum(['error', 'warning']),
  code: z.string(),
  message: z.string(),
  shotId: z.string().optional(),
})
const WireBeatAlignment = z.object({
  source: z.string(),
  trackTitle: z.string().nullable(),
  shots: z.array(
    z.object({ shotId: z.string(), atSec: z.number(), driftSec: z.number().nullable(), alignment: z.string() }),
  ),
})
const WirePlan = z.object({
  changes: z.array(RoughCutChange),
  unresolved: z.array(z.object({ shotId: z.string(), reason: z.string() })),
})
const WireApplied = z.object({
  applied: z.array(RoughCutChange),
  skipped: z.array(z.object({ change: RoughCutChange, reason: z.string() })),
})
const WireTrimmed = z.object({
  track: z.object({ id: z.string(), title: z.string(), endSec: z.number().nullable().optional() }),
  editBatchId: z.string().nullable(),
})

export const AlignToMusicInput = z.object({
  projectId: Id,
  action: z
    .enum(['check', 'plan', 'apply', 'trim_music'])
    .describe(
      'check = timeline issues and cuts that are off the beat; plan = rough-cut proposal (move cuts onto beats, ' +
        'trim, pick takes), changes nothing; apply = apply the given changes from plan; trim_music = end the master ' +
        'track at the last shot end (adds a fade-out).',
    ),
  changes: z.array(RoughCutChange).min(1).max(500).optional().describe('apply: the changes from plan (any subset).'),
})

const codesOf = async (api: ApiClient, projectId: string): Promise<ReadonlyMap<string, string>> => {
  const shots = await api.get(`/projects/${seg(projectId)}/shots`, z.array(WireShot))
  return new Map(shots.map((s) => [s.id, s.code]))
}

const withCode = <T extends { readonly shotId?: string }>(codes: ReadonlyMap<string, string>, row: T) =>
  row.shotId === undefined ? row : { code: codes.get(row.shotId) ?? row.shotId, ...row }

export const alignToMusicTool = defineTool({
  name: 'align_to_music',
  risk: 'write',
  description:
    'Fit the cut to the master track: check (issues + cuts off the beat), plan (a rough-cut proposal), apply ' +
    '(apply plan changes; stale ones are skipped with a reason), trim_music (end the song at the last shot). ' +
    'apply and trim_music are undoable.',
  input: AlignToMusicInput,
  handler: async ({ projectId, action, changes }, { api }) => {
    const base = `/projects/${seg(projectId)}`
    if (action === 'trim_music') {
      const trimmed = await api.post(`${base}/music-tracks/trim-to-shots`, {}, WireTrimmed)
      return jsonResult({
        trackId: trimmed.track.id,
        title: trimmed.track.title,
        endSec: trimmed.track.endSec ?? null,
        changed: trimmed.editBatchId !== null,
      })
    }
    if (action === 'apply') {
      if (changes === undefined) throw new ToolInputError('apply には changes（plan の結果）が要ります')
      const [codes, result] = await Promise.all([
        codesOf(api, projectId),
        api.post(`${base}/timeline/rough-cut/apply`, { changes, summary: 'AI エージェントの粗編集' }, WireApplied),
      ])
      return jsonResult({
        applied: result.applied.map((c) => withCode(codes, c)),
        skipped: result.skipped.map((s) => ({ ...withCode(codes, s.change), skippedBecause: s.reason })),
      })
    }
    const codes = await codesOf(api, projectId)
    if (action === 'plan') {
      const plan = await api.post(`${base}/timeline/rough-cut/plan`, {}, WirePlan)
      return jsonResult({
        // code は読むための添え物。apply に送り返しても落とされる。
        changes: plan.changes.map((c) => withCode(codes, c)),
        unresolved: plan.unresolved.map((u) => withCode(codes, u)),
      })
    }
    const [issues, beats] = await Promise.all([
      api.get(`${base}/timeline/issues`, z.array(WireIssue)),
      api.get(`${base}/timeline/beat-alignment`, WireBeatAlignment),
    ])
    const loose = beats.shots.filter((s) => s.alignment === 'off_beat' || s.alignment === 'near')
    return jsonResult({
      issues: issues.map((i) => withCode(codes, i)),
      beats: beats.source,
      ...(beats.trackTitle === null ? {} : { trackTitle: beats.trackTitle }),
      cutsChecked: beats.shots.length,
      offBeatCuts: loose.map((s) => ({
        code: codes.get(s.shotId) ?? s.shotId,
        shotId: s.shotId,
        atSec: round(s.atSec),
        driftSec: s.driftSec === null ? null : round(s.driftSec),
        alignment: s.alignment,
      })),
    })
  },
})
