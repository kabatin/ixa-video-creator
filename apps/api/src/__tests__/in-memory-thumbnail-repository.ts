import type { ThumbnailRepository } from '@ixa/db'
import {
  Thumbnail as ThumbnailSchema,
  ThumbnailId as ThumbnailIdSchema,
  newId,
  thumbnailViolation,
  type Thumbnail,
} from '@ixa/domain'

/** サムネイルの書き出し（ADR-0051）のインメモリ版。書くたびに状態と中身の食い違いを確かめる（実物と同じ）。 */
export type InMemoryThumbnailRepository = ThumbnailRepository & { readonly snapshot: () => readonly Thumbnail[] }

export const createInMemoryThumbnailRepository = (seed: readonly Thumbnail[] = []): InMemoryThumbnailRepository => {
  let store: readonly Thumbnail[] = seed
  const save = (thumbnail: Thumbnail): Thumbnail => {
    const parsed = ThumbnailSchema.parse(thumbnail)
    const violation = thumbnailViolation(parsed)
    if (violation !== null) throw new Error(violation)
    store = [...store.filter((candidate) => candidate.id !== parsed.id), parsed]
    return parsed
  }
  const update = (id: Thumbnail['id'], patch: Partial<Thumbnail>): Promise<Thumbnail> => {
    const current = store.find((candidate) => candidate.id === id)
    if (current === undefined) return Promise.reject(new Error(`サムネイルがありません: ${id}`))
    return Promise.resolve(save({ ...current, ...patch }))
  }
  return {
    snapshot: () => store,
    create: (input) =>
      Promise.resolve(
        save(
          ThumbnailSchema.parse({
            id: newId(ThumbnailIdSchema),
            projectId: input.projectId,
            spec: input.spec,
            status: 'queued',
            outputAssetId: null,
            fileName: input.fileName,
            error: null,
            createdAt: input.createdAt,
            finishedAt: null,
          }),
        ),
      ),
    findById: (id) => Promise.resolve(store.find((thumbnail) => thumbnail.id === id) ?? null),
    findByProject: (projectId) =>
      Promise.resolve(
        [...store.filter((thumbnail) => thumbnail.projectId === projectId)].sort((a, b) => b.id.localeCompare(a.id)),
      ),
    markRendering: (id) => update(id, { status: 'rendering' }),
    markDone: (id, outputAssetId) => update(id, { status: 'done', outputAssetId, finishedAt: new Date() }),
    markFailed: (id, error) => update(id, { status: 'failed', error, finishedAt: new Date() }),
  }
}
