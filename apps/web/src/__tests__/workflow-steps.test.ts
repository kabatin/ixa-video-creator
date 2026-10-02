import { describe, expect, it } from 'vitest'
import { workflowSteps, type WorkflowInput } from '@/lib/workflow-steps'

/**
 * 制作の流れの帯（制作者 2026-10-01）。音楽 → 作品の方針 → 区切る → Shot → 絵コンテ → 絵 → Take。
 * 「音楽 → 区切り → Shot → Take」と飛ばして、作品と関係ない映像ができた。次にやる所を示す。
 */

const shot = (overrides: Partial<WorkflowInput['shots'][number]> = {}): WorkflowInput['shots'][number] => ({
  description: '',
  hasStartFrame: false,
  adopted: false,
  ...overrides,
})

const input = (overrides: Partial<WorkflowInput> = {}): WorkflowInput => ({
  hasTrack: true,
  concept: '夜明けの屋上で二人が出会う',
  shots: [],
  ...overrides,
})

const stateOf = (result: ReturnType<typeof workflowSteps>, id: string) =>
  result.steps.find((step) => step.id === id)?.state

describe('workflowSteps', () => {
  it('7 段を順に並べる', () => {
    expect(workflowSteps(input()).steps.map((step) => step.label)).toEqual([
      '音楽',
      '作品の方針・歌詞',
      '区切る',
      'Shot',
      '絵コンテ',
      '絵',
      'Take',
    ])
  })

  it('楽曲が無ければ、次は ① 音楽', () => {
    const result = workflowSteps(input({ hasTrack: false }))
    expect(stateOf(result, 'music')).toBe('todo')
    expect(result.nextId).toBe('music')
  })

  it('楽曲があって方針が空なら、次は ② 作品の方針', () => {
    const result = workflowSteps(input({ concept: '  ' }))
    expect(stateOf(result, 'music')).toBe('done')
    expect(result.nextId).toBe('concept')
  })

  it('方針が読めていなければ「分からない」として次に選ばない', () => {
    const result = workflowSteps(input({ concept: null }))
    expect(stateOf(result, 'concept')).toBe('unknown')
    expect(result.nextId).toBe('cut')
  })

  it('Shot が無ければ、次は ③ 区切る（区切りは Shot にするまで保存されないので Shot の有無で見る）', () => {
    const result = workflowSteps(input())
    expect(stateOf(result, 'cut')).toBe('todo')
    expect(stateOf(result, 'shots')).toBe('todo')
    expect(result.nextId).toBe('cut')
  })

  it('絵コンテ・絵・Take は件数で途中を出し、次は最初に終わっていない段', () => {
    const result = workflowSteps(
      input({
        shots: [
          shot({ description: '屋上', hasStartFrame: true, adopted: true }),
          shot({ description: '階段' }),
          shot(),
        ],
      }),
    )
    const storyboard = result.steps.find((step) => step.id === 'storyboard')
    expect(storyboard).toMatchObject({ state: 'partial', progress: { done: 2, total: 3 } })
    expect(result.steps.find((step) => step.id === 'frames')).toMatchObject({
      state: 'partial',
      progress: { done: 1, total: 3 },
    })
    expect(result.steps.find((step) => step.id === 'takes')).toMatchObject({
      state: 'partial',
      progress: { done: 1, total: 3 },
    })
    expect(result.nextId).toBe('storyboard')
  })

  it('絵が付いているか分からない Shot があれば、絵の件数を出さない（「無い」と読み替えない）', () => {
    const result = workflowSteps(
      input({ shots: [shot({ description: 'a', hasStartFrame: null }), shot({ description: 'b' })] }),
    )
    expect(result.steps.find((step) => step.id === 'frames')).toMatchObject({
      state: 'unknown',
      progress: null,
    })
    expect(result.nextId).toBe('takes')
  })

  it('全部済めば次は無い', () => {
    const result = workflowSteps(
      input({ shots: [shot({ description: 'a', hasStartFrame: true, adopted: true })] }),
    )
    expect(result.steps.every((step) => step.state === 'done')).toBe(true)
    expect(result.nextId).toBeNull()
  })
})
