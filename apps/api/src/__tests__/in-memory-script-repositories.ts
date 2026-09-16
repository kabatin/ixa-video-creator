import {
  DbNotFoundError,
  type AppendedScriptVersion,
  type ScriptRepository,
  type SequenceRepository,
} from '@ixa/db'
import {
  CreateScriptInput as CreateScriptInputSchema,
  CreateScriptVersionInput as CreateScriptVersionInputSchema,
  CreateSequenceInput as CreateSequenceInputSchema,
  Script as ScriptSchema,
  ScriptId as ScriptIdSchema,
  ScriptVersion as ScriptVersionSchema,
  ScriptVersionId as ScriptVersionIdSchema,
  Sequence as SequenceSchema,
  SequenceId as SequenceIdSchema,
  UpdateSequencePatch as UpdateSequencePatchSchema,
  newId,
  type Script,
  type ScriptId,
  type ScriptVersion,
  type Sequence,
  type SequenceId,
} from '@ixa/domain'

/**
 * テスト用のインメモリ Script / Sequence リポジトリ（DOMAIN.md §8）。実 DB には接続しない。
 * 実装と同じく Domain 型のみを返し、保持する値は毎回作り直す（破壊的変更をしない）。
 */

export type InMemoryScriptRepository = ScriptRepository & {
  readonly snapshot: () => readonly Script[]
  /** 追記された版すべて。「既存の版が書き換わっていない」ことの確認に使う。 */
  readonly versionSnapshot: () => readonly ScriptVersion[]
}

export const createInMemoryScriptRepository = (): InMemoryScriptRepository => {
  let scripts: readonly Script[] = []
  let versions: readonly ScriptVersion[] = []

  const find = (id: ScriptId): Script | undefined => scripts.find((s) => s.id === id)

  const insert = (projectId: Script['projectId']): Script => {
    const created = ScriptSchema.parse({
      ...CreateScriptInputSchema.parse({ projectId }),
      id: newId(ScriptIdSchema),
    })
    scripts = [...scripts, created]
    return created
  }

  const replace = (updated: Script): Script => {
    scripts = scripts.map((s) => (s.id === updated.id ? updated : s))
    return updated
  }

  return {
    snapshot: () => scripts,
    versionSnapshot: () => versions,

    findById: (id) => Promise.resolve(find(id) ?? null),

    findByProject: (projectId) =>
      Promise.resolve(scripts.find((s) => s.projectId === projectId) ?? null),

    create: (input) => {
      const validated = CreateScriptInputSchema.parse(input)
      return Promise.resolve(insert(validated.projectId))
    },

    ensureForProject: (projectId) =>
      Promise.resolve(scripts.find((s) => s.projectId === projectId) ?? insert(projectId)),

    findVersionById: (id) => Promise.resolve(versions.find((v) => v.id === id) ?? null),

    listVersions: (scriptId) =>
      Promise.resolve(
        versions.filter((v) => v.scriptId === scriptId).sort((a, b) => b.version - a.version),
      ),

    appendVersion: (input): Promise<AppendedScriptVersion> => {
      const validated = CreateScriptVersionInputSchema.parse(input)
      const script = find(validated.scriptId)
      if (script === undefined) {
        return Promise.reject(new DbNotFoundError('Script', validated.scriptId))
      }

      // 1 始まりの連番。実装と同じく Script 内の最大値 + 1 を採る。
      const highest = versions
        .filter((v) => v.scriptId === script.id)
        .reduce((max, v) => Math.max(max, v.version), 0)

      const created = ScriptVersionSchema.parse({
        ...validated,
        id: newId(ScriptVersionIdSchema),
        version: highest + 1,
        createdAt: new Date(),
      })
      // 追記のみ。既存の要素には触れず、末尾に足すだけ。
      versions = [...versions, created]

      return Promise.resolve({
        script: replace(ScriptSchema.parse({ ...script, currentVersionId: created.id })),
        version: created,
      })
    },

    setCurrentVersion: (scriptId, versionId) => {
      const script = find(scriptId)
      if (script === undefined) return Promise.reject(new DbNotFoundError('Script', scriptId))
      return Promise.resolve(
        replace(ScriptSchema.parse({ ...script, currentVersionId: versionId })),
      )
    },
  }
}

export type InMemorySequenceRepository = SequenceRepository & {
  readonly snapshot: () => readonly Sequence[]
}

export const createInMemorySequenceRepository = (): InMemorySequenceRepository => {
  let store: readonly Sequence[] = []
  const find = (id: SequenceId): Sequence | undefined => store.find((s) => s.id === id)

  return {
    snapshot: () => store,

    findById: (id) => Promise.resolve(find(id) ?? null),

    findByProject: (projectId) =>
      Promise.resolve(
        store.filter((s) => s.projectId === projectId).sort((a, b) => a.order - b.order),
      ),

    create: (input) => {
      const created = SequenceSchema.parse({
        ...CreateSequenceInputSchema.parse(input),
        id: newId(SequenceIdSchema),
      })
      store = [...store, created]
      return Promise.resolve(created)
    },

    update: (id, patch) => {
      const current = find(id)
      if (current === undefined) return Promise.reject(new DbNotFoundError('Sequence', id))
      const updated = SequenceSchema.parse({
        ...current,
        ...UpdateSequencePatchSchema.parse(patch),
      })
      store = store.map((s) => (s.id === id ? updated : s))
      return Promise.resolve(updated)
    },

    softDelete: (id) => {
      if (find(id) === undefined) return Promise.reject(new DbNotFoundError('Sequence', id))
      // 実装は生存行のみ返すので、偽物はストアから取り除くだけでよい。
      store = store.filter((s) => s.id !== id)
      return Promise.resolve()
    },
  }
}
