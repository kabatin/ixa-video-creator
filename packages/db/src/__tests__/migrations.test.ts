import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MigrationJournal, migrationsFolder, pendingFromJournal } from '../migrations.js'

const journal = MigrationJournal.parse({
  entries: [
    { idx: 0, when: 100, tag: '0000_init' },
    { idx: 1, when: 200, tag: '0001_shots' },
    { idx: 2, when: 300, tag: '0002_takes' },
  ],
})

describe('pendingFromJournal（まだ当てていない DB の更新）', () => {
  it('1 本も当てていなければ全部', () => {
    expect(pendingFromJournal(journal, null)).toEqual(['0000_init', '0001_shots', '0002_takes'])
  })

  it('最後に当てた時刻より新しいものだけ（drizzle の migrator と同じ決め方）', () => {
    expect(pendingFromJournal(journal, 200)).toEqual(['0002_takes'])
  })

  it('全部当てていれば空', () => {
    expect(pendingFromJournal(journal, 300)).toEqual([])
  })
})

describe('MigrationJournal', () => {
  it('このリポジトリの _journal.json を読める', () => {
    const raw: unknown = JSON.parse(readFileSync(`${migrationsFolder}/meta/_journal.json`, 'utf8'))
    expect(MigrationJournal.parse(raw).entries.length).toBeGreaterThan(0)
  })

  it('形が違えば投げる（黙って 0 本にしない）', () => {
    expect(() => MigrationJournal.parse({ entries: [{ idx: 0, tag: 'x' }] })).toThrow()
  })
})
