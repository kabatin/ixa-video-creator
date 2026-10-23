import { z } from 'zod'
import { seg, type ApiClient } from '../api-client.js'
import { defineTool, Id, jsonResult, ToolInputError } from '../tool-def.js'

/**
 * シーケンス（章立て）を作る・直す・消す。結果はいつも、その作品のシーケンスの一覧（order 順）。
 * Shot をシーケンスに入れ直す口は API に無い（入れられるのは restructure_shots の insert で作るときだけ）。
 */

const WireSequence = z.object({
  id: z.string(),
  order: z.number(),
  name: z.string(),
  musicSectionLabel: z.string().nullable(),
  notes: z.string().optional(),
})

export const ManageSequencesInput = z.object({
  projectId: Id,
  action: z.enum(['list', 'create', 'update', 'delete']),
  sequenceId: Id.optional().describe('update / delete'),
  name: z.string().trim().min(1).max(200).optional().describe('create (required) / update. Japanese, e.g. 「サビ 1」.'),
  order: z.number().int().optional().describe('create / update. Default for create: after the last one.'),
  musicSectionLabel: z.string().max(100).nullable().optional().describe('Music section this chapter follows, if any.'),
  notes: z.string().max(4000).optional(),
})
type SequenceArgs = z.infer<typeof ManageSequencesInput>

const listOf = async (api: ApiClient, projectId: string) =>
  [...(await api.get(`/projects/${seg(projectId)}/sequences`, z.array(WireSequence)))].sort((a, b) => a.order - b.order)

const fieldsOf = (args: SequenceArgs) => ({
  ...(args.name === undefined ? {} : { name: args.name }),
  ...(args.order === undefined ? {} : { order: args.order }),
  ...(args.musicSectionLabel === undefined ? {} : { musicSectionLabel: args.musicSectionLabel }),
  ...(args.notes === undefined ? {} : { notes: args.notes }),
})

/** 別の作品のシーケンスを触らない（API の /sequences/{id} は作品を見ない）。 */
const ownSequenceId = (args: SequenceArgs, sequences: readonly z.infer<typeof WireSequence>[]): string => {
  if (args.sequenceId === undefined) throw new ToolInputError(`${args.action} には sequenceId が要ります`)
  if (!sequences.some((s) => s.id === args.sequenceId)) throw new ToolInputError('sequenceId がこの作品にありません')
  return args.sequenceId
}

const apply = async (api: ApiClient, args: SequenceArgs): Promise<void> => {
  if (args.action === 'list') return
  const current = await listOf(api, args.projectId)
  if (args.action === 'create') {
    if (args.name === undefined) throw new ToolInputError('create には name が要ります')
    const order = args.order ?? current.reduce((max, s) => Math.max(max, s.order + 1), 0)
    await api.post(`/projects/${seg(args.projectId)}/sequences`, { ...fieldsOf(args), order }, WireSequence)
    return
  }
  const id = ownSequenceId(args, current)
  if (args.action === 'delete') {
    await api.request('DELETE', `/sequences/${seg(id)}`, z.unknown())
    return
  }
  const patch = fieldsOf(args)
  if (Object.keys(patch).length === 0) throw new ToolInputError('update には変える欄を 1 つ以上')
  await api.request('PATCH', `/sequences/${seg(id)}`, WireSequence, { body: patch })
}

export const manageSequencesTool = defineTool({
  name: 'manage_sequences',
  risk: 'destructive',
  description:
    'List, create, update or delete the chapters (sequences) of the project. Always returns the current list. ' +
    'New shots join a chapter via restructure_shots insert {sequenceId}.',
  input: ManageSequencesInput,
  handler: async (args, { api }) => {
    await apply(api, args)
    return jsonResult({ sequences: await listOf(api, args.projectId) })
  },
})
