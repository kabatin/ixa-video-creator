import type { ImageCheckRepository } from '@ixa/db'
import {
  ImageCheck as ImageCheckSchema,
  ImageCheckId as ImageCheckIdSchema,
  imageCheckViolation,
  newId,
  type ImageCheck,
} from '@ixa/domain'

/** 作った絵のチェック（ADR-0055）のインメモリ版。実物と同じく、ジョブに 1 行で、2 度目は前の行を返す。 */
export type InMemoryImageCheckRepository = ImageCheckRepository & { readonly snapshot: () => readonly ImageCheck[] }

export const createInMemoryImageCheckRepository = (seed: readonly ImageCheck[] = []): InMemoryImageCheckRepository => {
  let store: readonly ImageCheck[] = seed
  return {
    snapshot: () => store,
    create: (input) => {
      const existing = store.find((check) => check.imageJobId === input.imageJobId)
      if (existing !== undefined) return Promise.resolve(existing)
      const check = ImageCheckSchema.parse({ ...input, id: newId(ImageCheckIdSchema), createdAt: new Date() })
      const violation = imageCheckViolation(check)
      if (violation !== null) return Promise.reject(new Error(violation))
      store = [...store, check]
      return Promise.resolve(check)
    },
    findByJobId: (imageJobId) => Promise.resolve(store.find((check) => check.imageJobId === imageJobId) ?? null),
    findByJobIds: (ids) => Promise.resolve(store.filter((check) => ids.includes(check.imageJobId))),
  }
}
