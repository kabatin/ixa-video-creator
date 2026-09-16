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

/** Script の作成。currentVersionId は最初の版を追記するまで null。 */
export const CreateScriptInput = Script.omit({ id: true }).extend({
  currentVersionId: ScriptVersionId.nullable().default(null),
})
export type CreateScriptInput = z.input<typeof CreateScriptInput>

/**
 * 版の追記。**version はリポジトリが採番する**（Take の index と同じ）。
 * 呼び出し側に採番させると、同時に 2 つ追記されたとき番号が衝突する。
 */
export const CreateScriptVersionInput = ScriptVersion.omit({
  id: true,
  version: true,
  createdAt: true,
})
export type CreateScriptVersionInput = z.input<typeof CreateScriptVersionInput>

export const CreateSequenceInput = Sequence.omit({ id: true })
export type CreateSequenceInput = z.input<typeof CreateSequenceInput>

/** 更新できる列。projectId は移し替えを許さないので含めない。 */
export const UpdateSequencePatch = Sequence.pick({
  order: true,
  name: true,
  musicSectionLabel: true,
  notes: true,
}).partial()
export type UpdateSequencePatch = z.input<typeof UpdateSequencePatch>
