import { DbNotFoundError, type GenerationJobRepository } from '@ixa/db'
import {
  CreateGenerationJobInput as CreateGenerationJobInputSchema,
  GenerationJob as GenerationJobSchema,
  GenerationJobId as GenerationJobIdSchema,
  UpdateGenerationJobPatch as UpdateGenerationJobPatchSchema,
  newId,
  type GenerationJob,
  type GenerationJobId,
} from '@ixa/domain'

/** テスト用のインメモリ GenerationJobRepository。実 DB には接続しない。 */
export type InMemoryGenerationJobRepository = GenerationJobRepository & {
  readonly snapshot: () => readonly GenerationJob[]
}

export const createInMemoryGenerationJobRepository = (
  seed: readonly GenerationJob[] = [],
): InMemoryGenerationJobRepository => {
  let store: readonly GenerationJob[] = seed.map((job) => GenerationJobSchema.parse(job))

  const find = (id: GenerationJobId): GenerationJob | undefined => store.find((j) => j.id === id)

  return {
    snapshot: () => store,

    findById: (id) => Promise.resolve(find(id) ?? null),

    findByShot: (shotId) =>
      Promise.resolve(
        store.filter((job) => job.shotId === shotId).sort((a, b) => (a.id < b.id ? -1 : 1)),
      ),

    create: (input) => {
      const validated = CreateGenerationJobInputSchema.parse(input)
      const created = GenerationJobSchema.parse({
        ...validated,
        id: newId(GenerationJobIdSchema),
        queuedAt: new Date(),
        startedAt: null,
        providerStartedAt: null,
        finishedAt: null,
      })
      store = [...store, created]
      return Promise.resolve(created)
    },

    update: (id, patch) => {
      const current = find(id)
      if (current === undefined) return Promise.reject(new DbNotFoundError('GenerationJob', id))
      const validated = UpdateGenerationJobPatchSchema.parse(patch)
      const updated = GenerationJobSchema.parse({ ...current, ...validated })
      store = store.map((job) => (job.id === id ? updated : job))
      return Promise.resolve(updated)
    },
  }
}
