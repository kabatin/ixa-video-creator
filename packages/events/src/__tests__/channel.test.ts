import { describe, expect, it } from 'vitest'
import { projectEventChannel } from '../channel.js'
import { PROJECT_A, PROJECT_B } from './fixtures.js'

describe('projectEventChannel', () => {
  it('ixa:project:{projectId}:events の形を返す', () => {
    expect(projectEventChannel(PROJECT_A)).toBe(`ixa:project:${PROJECT_A}:events`)
  })

  it('Project が違えば別のチャンネルになる', () => {
    expect(projectEventChannel(PROJECT_A)).not.toBe(projectEventChannel(PROJECT_B))
  })
})
