import { z } from 'zod'
import { ProjectId, ScriptId, ScriptVersionId, SequenceId } from '../common/ids.js'

export const Script = z.object({
  id: ScriptId,
  projectId: ProjectId,
  currentVersionId: ScriptVersionId.nullable(),
})
export type Script = z.infer<typeof Script>

export const ScriptVersion = z.object({
  id: ScriptVersionId,
  scriptId: ScriptId,
  version: z.number().int().positive(),
  content: z.string(),
  authoredBy: z.enum(['human', 'ai']),
  createdAt: z.date(),
})
export type ScriptVersion = z.infer<typeof ScriptVersion>

export const Sequence = z.object({
  id: SequenceId,
  projectId: ProjectId,
  order: z.number().int(),
  name: z.string(),
  musicSectionLabel: z.string().nullable(),
  notes: z.string().default(''),
})
export type Sequence = z.infer<typeof Sequence>
