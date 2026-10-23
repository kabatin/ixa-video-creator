import { AssistField } from '@ixa/domain'
import { z } from 'zod'
import { seg, type ApiClient } from '../api-client.js'
import { WireShot } from '../wire.js'
import { defineTool, Id, jsonResult, ToolInputError } from '../tool-def.js'

/**
 * 絵コンテの案（PHASE 6.3）と、欄の文の案（ADR-0032）。どちらも「使う AI」のテキストの AI が書く。
 * **案は Shot を書き換えない。** 書き換えるのは採用（adopt）だけで、採用する Shot は必ず列挙する。
 */

/** 1 回の採用の上限（API の MAX_ADOPT_SHOT_IDS と同じ）。 */
const MAX_ADOPT_SHOT_IDS = 500
/** 欄の手伝いの指示の上限（provider-llm の MAX_ASSIST_INSTRUCTION_LENGTH と同じ）。 */
const MAX_ASSIST_INSTRUCTION_LENGTH = 300

const WireRun = z.object({
  id: z.string(),
  drafter: z.string(),
  status: z.string(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  createdAt: z.string(),
})
const WireItem = z.object({
  shotId: z.string(),
  description: z.string(),
  mood: z.string().nullable(),
  reason: z.string(),
  camera: z.record(z.string(), z.unknown()).nullable().optional(),
  adoptedAt: z.string().nullable(),
})
const WireDraft = z.object({ run: WireRun.nullable(), items: z.array(WireItem) })
const WireAdopted = z.object({ adopted: z.array(WireItem), shots: z.array(WireShot) })
const WireAssist = z.object({ text: z.string(), costUsd: z.number() })

export const DraftStoryboardInput = z.object({
  projectId: Id,
  action: z
    .enum(['draft', 'latest', 'adopt', 'suggest'])
    .describe(
      'draft = the text AI proposes description/mood/camera for every shot (takes minutes; shots are not changed); ' +
        'latest = read the last proposal; adopt = write the proposal of the listed shots into them; ' +
        'suggest = one text suggestion for a single field.',
    ),
  runId: Id.optional().describe('adopt: the run id from draft/latest.'),
  shotIds: z
    .array(Id)
    .min(1)
    .max(MAX_ADOPT_SHOT_IDS)
    .refine((ids) => new Set(ids).size === ids.length, 'duplicate shot ids')
    .optional()
    .describe('adopt: the shots to overwrite. Always list them explicitly.'),
  field: AssistField.optional().describe(
    'suggest: concept, look, avoid, shot_description / shot_mood (need shotId), identity_anchors (characterId), ' +
      'wardrobe (lookId), location_description (locationId), narration_script.',
  ),
  current: z.string().max(4000).default('').describe('suggest: the field text now.'),
  instruction: z.string().trim().max(MAX_ASSIST_INSTRUCTION_LENGTH).optional().describe('suggest: what to aim for.'),
  shotId: Id.optional(),
  characterId: Id.optional(),
  lookId: Id.optional(),
  locationId: Id.optional(),
})
type Args = z.infer<typeof DraftStoryboardInput>

const codesOf = async (api: ApiClient, projectId: string): Promise<ReadonlyMap<string, string>> => {
  const shots = await api.get(`/projects/${seg(projectId)}/shots`, z.array(WireShot))
  return new Map(shots.map((s) => [s.id, s.code]))
}

const compactDraft = (draft: z.infer<typeof WireDraft>, codes: ReadonlyMap<string, string>) => ({
  run:
    draft.run === null
      ? null
      : {
          id: draft.run.id,
          status: draft.run.status,
          drafter: draft.run.drafter,
          createdAt: draft.run.createdAt,
          ...(draft.run.error === null ? {} : { error: draft.run.error.message }),
        },
  items: draft.items.map((item) => ({
    shotId: item.shotId,
    code: codes.get(item.shotId) ?? item.shotId,
    description: item.description,
    ...(item.mood === null ? {} : { mood: item.mood }),
    ...(item.camera === null || item.camera === undefined ? {} : { camera: item.camera }),
    reason: item.reason,
    adopted: item.adoptedAt !== null,
  })),
})

const suggest = async (api: ApiClient, args: Args) => {
  if (args.field === undefined) throw new ToolInputError('suggest には field が要ります')
  const result = await api.post(
    `/projects/${seg(args.projectId)}/assist`,
    {
      field: args.field,
      current: args.current,
      instruction: args.instruction === undefined || args.instruction === '' ? null : args.instruction,
      ...(args.shotId === undefined ? {} : { shotId: args.shotId }),
      ...(args.characterId === undefined ? {} : { characterId: args.characterId }),
      ...(args.lookId === undefined ? {} : { lookId: args.lookId }),
      ...(args.locationId === undefined ? {} : { locationId: args.locationId }),
    },
    WireAssist,
  )
  return { field: args.field, text: result.text, costUsd: result.costUsd }
}

export const draftStoryboardTool = defineTool({
  name: 'draft_storyboard',
  // テキストの AI（CLI の利用枠）を使う。
  risk: 'costly',
  // 読み返すだけ・案を Shot に写すだけなら AI を使わない。
  riskOf: (args) => (args.action === 'latest' ? 'read' : args.action === 'adopt' ? 'write' : 'costly'),
  description:
    'Storyboard proposals by the selected text AI: draft one for all shots, read the latest, adopt it for listed ' +
    'shots (overwrites their description/mood/camera; undoable), or suggest text for one field. ' +
    'Writing shots yourself with edit_shots is usually faster.',
  input: DraftStoryboardInput,
  handler: async (args, { api }) => {
    const base = `/projects/${seg(args.projectId)}/storyboard/drafts`
    if (args.action === 'suggest') return jsonResult(await suggest(api, args))
    if (args.action === 'adopt') {
      if (args.runId === undefined || args.shotIds === undefined) {
        throw new ToolInputError('adopt には runId と shotIds が要ります')
      }
      const adopted = await api.post(`${base}/${seg(args.runId)}/adopt`, { shotIds: args.shotIds }, WireAdopted)
      return jsonResult({
        adopted: adopted.shots.map((s) => ({ shotId: s.id, code: s.code, description: s.description ?? '', mood: s.mood })),
      })
    }
    const draft = args.action === 'draft' ? await api.post(base, {}, WireDraft) : await api.get(base, WireDraft)
    return jsonResult(compactDraft(draft, await codesOf(api, args.projectId)))
  },
})
