import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { generationJobs, takes } from '../schema/generation.js'

/** ADR-0057。「NG なら自動で作り直す」は頼んだジョブと、できた Take の両方に残す（既定は作り直さない）。 */
describe('auto_retake の列', () => {
  it.each([
    ['generation_jobs', generationJobs],
    ['takes', takes],
  ])('%s は auto_retake を持ち、既定は false で null にならない', (_name, table) => {
    const column = getTableConfig(table).columns.find((candidate) => candidate.name === 'auto_retake')
    expect(column?.notNull).toBe(true)
    expect(column?.default).toBe(false)
  })
})
