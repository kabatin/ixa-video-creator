import type { EditRepositories, EditTransaction } from '@ixa/db'
import type { InMemoryEditBatchRepository } from './in-memory-edit-batch-repository.js'

/** 巻き戻せる記録（メモリ版）か、巻き戻せない記録（そのまま書くだけ）。 */
type Recorder = EditRepositories['editBatches'] & Partial<Pick<InMemoryEditBatchRepository, 'snapshot' | 'reset'>>

/**
 * テスト用の `EditTransaction`。`fn` が投げたら**記録を巻き戻す**（本物のトランザクションと同じく、
 * 書き込みに失敗した操作の記録は残らない）。記録以外の書き込みは巻き戻さない
 * （「記録を書く前に作る」順序が崩れると、書き込みだけが残ってテストで分かる）。
 *
 * 渡さなかったリポジトリは、呼ばれたら落ちる（その経路が触らないことも確かめる）。
 */
type Given = Partial<Omit<EditRepositories, 'editBatches'>> & { readonly editBatches: Recorder }

const unused = <T extends object>(name: string): T =>
  new Proxy({} as T, {
    get: (_target, key) => () => Promise.reject(new Error(`${name}.${String(key)} は呼ばれない想定です`)),
  })

export const createInMemoryEditTransaction = (given: Given): EditTransaction => {
  const repos: EditRepositories = {
    editBatches: given.editBatches,
    timelineClips: given.timelineClips ?? unused('timelineClips'),
    transitions: given.transitions ?? unused('transitions'),
    shots: given.shots ?? unused('shots'),
    shotCharacters: given.shotCharacters ?? unused('shotCharacters'),
    shotReferences: given.shotReferences ?? unused('shotReferences'),
    musicTracks: given.musicTracks ?? unused('musicTracks'),
    narrationLines: given.narrationLines ?? unused('narrationLines'),
  }
  return async (fn) => {
    const before = given.editBatches.snapshot?.()
    try {
      return await fn(repos)
    } catch (error) {
      if (before !== undefined) given.editBatches.reset?.(before)
      throw error
    }
  }
}

/** 記録を作れない `EditTransaction`（書く前に記録することを確かめる）。記録以外は `given` のまま使う。 */
export const createFailingRecordTransaction = (given: Given): EditTransaction => {
  const inner = createInMemoryEditTransaction(given)
  return (fn) =>
    inner((repos) =>
      fn({ ...repos, editBatches: { create: () => Promise.reject(new Error('記録を作れません')) } }),
    )
}
