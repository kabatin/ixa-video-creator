import { describe, expect, it } from 'vitest'
import { manageSequencesTool } from '../tools/sequences.js'
import { createFakeApi, depsFor, jsonOf, textOf, ulid } from './fake-api.js'

const PROJECT = ulid('PJ1')
const SEQ_A = ulid('SQA')
const SEQ_B = ulid('SQB')
const FOREIGN = ulid('SQF')

const seq = (id: string, order: number, name: string) => ({ id, projectId: PROJECT, order, name, musicSectionLabel: null, notes: '' })
const listRoute = { method: 'GET', path: `/projects/${PROJECT}/sequences`, data: [seq(SEQ_B, 1, 'サビ'), seq(SEQ_A, 0, 'イントロ')] }

describe('manage_sequences', () => {
  it('list は order 順', async () => {
    const result = jsonOf(await manageSequencesTool.run({ projectId: PROJECT, action: 'list' }, depsFor(createFakeApi([listRoute]))))
    expect(result).toEqual({
      sequences: [
        { id: SEQ_A, order: 0, name: 'イントロ', musicSectionLabel: null, notes: '' },
        { id: SEQ_B, order: 1, name: 'サビ', musicSectionLabel: null, notes: '' },
      ],
    })
  })

  it('create は最後の後ろの order で作る', async () => {
    const fake = createFakeApi([
      listRoute,
      { method: 'POST', path: `/projects/${PROJECT}/sequences`, status: 201, data: seq(ulid('SQC'), 2, 'アウトロ') },
    ])
    await manageSequencesTool.run({ projectId: PROJECT, action: 'create', name: 'アウトロ', musicSectionLabel: 'outro' }, depsFor(fake))
    expect(fake.callsTo('POST', `/projects/${PROJECT}/sequences`)[0]?.body).toEqual({ name: 'アウトロ', musicSectionLabel: 'outro', order: 2 })
  })

  it('update・delete は作品のシーケンスだけ', async () => {
    const fake = createFakeApi([
      listRoute,
      { method: 'PATCH', path: `/sequences/${SEQ_A}`, data: seq(SEQ_A, 0, '序') },
      { method: 'DELETE', path: `/sequences/${SEQ_B}`, status: 204 },
    ])
    await manageSequencesTool.run({ projectId: PROJECT, action: 'update', sequenceId: SEQ_A, name: '序' }, depsFor(fake))
    await manageSequencesTool.run({ projectId: PROJECT, action: 'delete', sequenceId: SEQ_B }, depsFor(fake))
    expect(fake.callsTo('PATCH', `/sequences/${SEQ_A}`)[0]?.body).toEqual({ name: '序' })
    expect(fake.callsTo('DELETE', `/sequences/${SEQ_B}`)).toHaveLength(1)
    const foreign = await manageSequencesTool.run({ projectId: PROJECT, action: 'delete', sequenceId: FOREIGN }, depsFor(fake))
    expect(textOf(foreign)).toContain('この作品にありません')
    expect(fake.callsTo('DELETE', /.*/)).toHaveLength(1)
  })

  it('create に name が無い・update に欄が無いと断る', async () => {
    const fake = createFakeApi([listRoute])
    expect(textOf(await manageSequencesTool.run({ projectId: PROJECT, action: 'create' }, depsFor(fake)))).toContain('name')
    expect(textOf(await manageSequencesTool.run({ projectId: PROJECT, action: 'update', sequenceId: SEQ_A }, depsFor(fake)))).toContain('1 つ以上')
  })
})
