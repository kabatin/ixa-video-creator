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
  lyricLineCount: 0,
  lyricCueCount: 0,
  shots: [],
  ...overrides,
})

const stateOf = (result: ReturnType<typeof workflowSteps>, id: string) =>
  result.steps.find((step) => step.id === id)?.state

describe('workflowSteps', () => {
  it('8 段を順に並べる（歌詞の時刻は区切る前）', () => {
    expect(workflowSteps(input()).steps.map((step) => step.label)).toEqual([
      '音楽',
      '作品の方針・歌詞',
      '歌詞の時刻',
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

  /**
   * 歌詞の時刻（制作者 2026-10-02「テロップみたいな、やり直しが容易にできるものを、ステップの前に持ってった方が効率的」）。
   * 区切ってから時刻を付けると、境目が歌い出しとずれた（中央値 1.95 秒）。区切る前に済ませる。
   */
  it('歌詞があって時刻が足りなければ、区切るより先に ③ 歌詞の時刻（件数を出す）', () => {
    const result = workflowSteps(input({ lyricLineCount: 58, lyricCueCount: 12 }))
    const lyrics = result.steps.find((step) => step.id === 'lyrics')
    expect(lyrics?.state).toBe('partial')
    expect(lyrics?.progress).toEqual({ done: 12, total: 58 })
    expect(result.nextId).toBe('lyrics')

    expect(workflowSteps(input({ lyricLineCount: 3, lyricCueCount: 0 })).nextId).toBe('lyrics')
  })

  it('全部の行に時刻が付けば済み', () => {
    const result = workflowSteps(input({ lyricLineCount: 3, lyricCueCount: 3 }))
    expect(stateOf(result, 'lyrics')).toBe('done')
    expect(result.nextId).toBe('cut')
  })

  it('歌詞が無い作品では飛ばす（次に選ばない）', () => {
    const result = workflowSteps(input({ lyricLineCount: 0 }))
    expect(stateOf(result, 'lyrics')).toBe('skipped')
    expect(result.nextId).toBe('cut')
  })

  it('Shot が無ければ、次は ④ 区切る（区切りは Shot にするまで保存されないので Shot の有無で見る）', () => {
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
      input({
        lyricLineCount: 2,
        lyricCueCount: 2,
        shots: [shot({ description: 'a', hasStartFrame: true, adopted: true })],
      }),
    )
    expect(result.steps.every((step) => step.state === 'done')).toBe(true)
    expect(result.nextId).toBeNull()
    // 歌詞の無い作品は、歌詞の段だけ飛ばして済み。
    const instrumental = workflowSteps(
      input({ shots: [shot({ description: 'a', hasStartFrame: true, adopted: true })] }),
    )
    expect(instrumental.steps.every((step) => step.state === 'done' || step.id === 'lyrics')).toBe(true)
    expect(instrumental.nextId).toBeNull()
  })
})
