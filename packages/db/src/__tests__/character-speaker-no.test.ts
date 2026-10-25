import { ProjectId, WorkspaceId, newId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import type { DbExecutor } from '../client.js'
import { createCharacterRepository } from '../repositories/character-repository.js'

/**
 * 話し手の番号（ADR-0059）は INSERT の中で数える。同時に作ると一意索引が片方を落とすので、
 * **1 回だけ数え直して入れ直す**（500 にしない）。2 回続けて重なったら投げる（黙って番号を重ねない）。
 * 実 DB には繋がない。INSERT の口だけを持つ偽物で、投げる例外の形（postgres の 23505）を再現する。
 */

const uniqueViolation = (): Error =>
  Object.assign(new Error('insert failed'), { cause: Object.assign(new Error('duplicate key'), { code: '23505' }) })

const fakeDb = (failures: number) => {
  let attempts = 0
  const db = {
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        returning: () => {
          attempts += 1
          if (attempts <= failures) return Promise.reject(uniqueViolation())
          return Promise.resolve([{ ...values, speakerNo: 2, deletedAt: null }])
        },
      }),
    }),
  }
  return { db: db as unknown as DbExecutor, attempts: () => attempts }
}

const input = {
  workspaceId: newId(WorkspaceId),
  projectId: newId(ProjectId),
  name: 'neko',
  displayName: 'ネコ',
}

describe('キャラクターを作るときの話し手の番号', () => {
  it('同時に作って番号が重なったら、1 回だけ入れ直す', async () => {
    const fake = fakeDb(1)
    const created = await createCharacterRepository(fake.db).create(input)
    expect(created.speakerNo).toBe(2)
    expect(fake.attempts()).toBe(2)
  })

  it('入れ直しても重なったら投げる', async () => {
    const fake = fakeDb(2)
    await expect(createCharacterRepository(fake.db).create(input)).rejects.toThrow('insert failed')
    expect(fake.attempts()).toBe(2)
  })

  it('ほかの失敗は入れ直さない', async () => {
    const db = {
      insert: () => ({ values: () => ({ returning: () => Promise.reject(new Error('connection lost')) }) }),
    } as unknown as DbExecutor
    await expect(createCharacterRepository(db).create(input)).rejects.toThrow('connection lost')
  })
})
