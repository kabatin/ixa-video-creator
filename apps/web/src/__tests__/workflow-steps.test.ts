import { describe, expect, it } from 'vitest'
import { lyricTelopCountOf, workflowSteps, type WorkflowInput } from '@/lib/workflow-steps'

/**
 * 制作の流れの帯（制作者 2026-10-01）。「音楽 → 区切り → Shot → Take」と飛ばして、作品と関係ない映像ができた。
 * 次にやる所を示す。
 *
 * 2026-10-03 に並べ直した（制作者「楽曲を登録すると次何したらいいんだ？ってなる」「まずはテロップのタイミングをセット」
 * 「テロップがあるだけではプレビューが再生できず」）。楽曲 → 作品の方針（方針・歌詞・ルック）→ 歌詞の時刻 → テロップ →
 * 区切って Shot → 絵コンテ → 絵 → Take → 書き出す。
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
  hasLook: true,
  instrumental: false,
  lyricLineCount: 3,
  lyricCueCount: 3,
  lyricTelopCount: 3,
  narration: { lines: 0, ready: 0 },
  shots: [],
  rendered: false,
  ...overrides,
})

const stepOf = (result: ReturnType<typeof workflowSteps>, id: string) => result.steps.find((step) => step.id === id)
const stateOf = (result: ReturnType<typeof workflowSteps>, id: string) => stepOf(result, id)?.state

const allDone = (overrides: Partial<WorkflowInput> = {}) =>
  input({
    shots: [shot({ description: 'a', hasStartFrame: true, adopted: true })],
    narration: { lines: 1, ready: 1 },
    rendered: true,
    ...overrides,
  })

describe('workflowSteps', () => {
  it('10 段を作業の順に並べる（テロップとナレーションは区切る前、書き出すが最後）', () => {
    expect(workflowSteps(input()).steps.map((step) => step.label)).toEqual([
      '楽曲',
      '作品の方針',
      '歌詞の時刻',
      'テロップ',
      'ナレーション',
      '区切って Shot',
      '絵コンテ',
      '絵',
      'Take',
      '書き出す',
    ])
  })

  /** ナレーション（ADR-0038）。曲のある作品では入れなくてよい。曲が無ければ、ナレーションが作品の芯になる。 */
  describe('ナレーション', () => {
    it('曲があってナレーションが無ければ、要らない段として飛ばす', () => {
      expect(stateOf(workflowSteps(input()), 'narration')).toBe('skipped')
    })

    it('曲もナレーションも無ければ、楽曲とナレーションのどちらもまだ（次は楽曲）', () => {
      const result = workflowSteps(input({ hasTrack: false }))
      expect(stateOf(result, 'narration')).toBe('todo')
      expect(result.nextId).toBe('music')
    })

    it('曲が無くてナレーションがあれば、楽曲は飛ばし、声を作って置いた行を数える', () => {
      const result = workflowSteps(
        input({ hasTrack: false, instrumental: true, lyricLineCount: 0, lyricCueCount: 0, narration: { lines: 3, ready: 1 } }),
      )
      expect(stateOf(result, 'music')).toBe('skipped')
      expect(stepOf(result, 'narration')).toMatchObject({ state: 'partial', progress: { done: 1, total: 3 } })
      expect(result.nextId).toBe('narration')
    })

    it('曲のある作品でもナレーションを入れていれば数える', () => {
      expect(stepOf(workflowSteps(input({ narration: { lines: 2, ready: 2 } })), 'narration')?.state).toBe('done')
    })

    it('読めていなければ「分からない」（次の段に選ばない）', () => {
      expect(stateOf(workflowSteps(input({ narration: null })), 'narration')).toBe('unknown')
    })
  })

  it('楽曲が無ければ、次は ① 楽曲', () => {
    const result = workflowSteps(input({ hasTrack: false }))
    expect(stateOf(result, 'music')).toBe('todo')
    expect(result.nextId).toBe('music')
  })

  /** 制作者「コンセプト・あらすじの入力、歌詞の入力、ルックの設定をさせたい」。3 つを数える。 */
  it('作品の方針は、方針・歌詞・ルックの 3 つを数える。どれか欠ければ途中で、次はここ', () => {
    const none = workflowSteps(input({ concept: '  ', lyricLineCount: 0, hasLook: false }))
    expect(stepOf(none, 'concept')).toMatchObject({ state: 'todo', progress: { done: 0, total: 3 } })
    expect(none.nextId).toBe('concept')

    const noLook = workflowSteps(input({ hasLook: false }))
    expect(stepOf(noLook, 'concept')).toMatchObject({ state: 'partial', progress: { done: 2, total: 3 } })
    expect(noLook.nextId).toBe('concept')

    expect(stateOf(workflowSteps(input()), 'concept')).toBe('done')
  })

  it('方針が読めていなければ「分からない」として次に選ばない', () => {
    const result = workflowSteps(input({ concept: null, lyricTelopCount: 0 }))
    expect(stateOf(result, 'concept')).toBe('unknown')
    expect(result.nextId).toBe('telops')
  })

  it('歌詞があって時刻が足りなければ、次は ③ 歌詞の時刻（件数を出す）', () => {
    const result = workflowSteps(input({ lyricLineCount: 58, lyricCueCount: 12, lyricTelopCount: 0 }))
    expect(stepOf(result, 'lyrics')).toMatchObject({ state: 'partial', progress: { done: 12, total: 58 } })
    expect(result.nextId).toBe('lyrics')
  })

  /** 制作者「まずはテロップのタイミングをセット」「テロップだけ確認は必須かも」。区切る前に、黒い画面で確かめられる。 */
  it('時刻が付いてテロップが無ければ、区切るより先に ④ テロップ', () => {
    const result = workflowSteps(input({ lyricTelopCount: 0 }))
    expect(stateOf(result, 'telops')).toBe('todo')
    expect(result.nextId).toBe('telops')
  })

  it('テロップの数が読めていなければ「分からない」として次に選ばない', () => {
    const result = workflowSteps(input({ lyricTelopCount: null }))
    expect(stateOf(result, 'telops')).toBe('unknown')
    expect(result.nextId).toBe('shots')
  })

  /**
   * 「歌詞なし」にした作品（制作者 2026-10-04「歌詞がない動画の場合、歌詞を入力しないので、作品の方針が 2/3 でとまって
   * しまいます。歌詞なしのチェックボックスとかあるといいかも」）。方針は方針・ルックの 2 つで済み、歌詞の段は飛ばす。
   */
  it('歌詞なしの作品は、作品の方針を方針・ルックの 2 つで数え、歌詞の時刻とテロップを飛ばす', () => {
    const result = workflowSteps(input({ instrumental: true, lyricLineCount: 0, lyricCueCount: 0, lyricTelopCount: 0 }))
    expect(stepOf(result, 'concept')).toMatchObject({ state: 'done', progress: { done: 2, total: 2 } })
    expect(stateOf(result, 'lyrics')).toBe('skipped')
    expect(stateOf(result, 'telops')).toBe('skipped')
    expect(result.nextId).toBe('shots')
  })

  it('歌詞なしにしたら、歌詞が書いてあっても歌詞の段は飛ばす', () => {
    const result = workflowSteps(input({ instrumental: true, lyricCueCount: 0, lyricTelopCount: 0 }))
    expect(stateOf(result, 'lyrics')).toBe('skipped')
    expect(result.nextId).toBe('shots')
  })

  it('歌詞が無い作品では、歌詞の時刻とテロップを飛ばす（次に選ばない）', () => {
    const result = workflowSteps(input({ lyricLineCount: 0, lyricCueCount: 0, lyricTelopCount: 0 }))
    expect(stateOf(result, 'lyrics')).toBe('skipped')
    expect(stateOf(result, 'telops')).toBe('skipped')
  })

  it('Shot が無ければ、次は ⑤ 区切って Shot（区切りは Shot にするまで保存されないので Shot の有無で見る）', () => {
    const result = workflowSteps(input())
    expect(stateOf(result, 'shots')).toBe('todo')
    expect(result.nextId).toBe('shots')
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
    expect(stepOf(result, 'storyboard')).toMatchObject({ state: 'partial', progress: { done: 2, total: 3 } })
    expect(stepOf(result, 'frames')).toMatchObject({ state: 'partial', progress: { done: 1, total: 3 } })
    expect(stepOf(result, 'takes')).toMatchObject({ state: 'partial', progress: { done: 1, total: 3 } })
    expect(result.nextId).toBe('storyboard')
  })

  it('絵が付いているか分からない Shot があれば、絵の件数を出さない（「無い」と読み替えない）', () => {
    const result = workflowSteps(
      input({ shots: [shot({ description: 'a', hasStartFrame: null }), shot({ description: 'b' })] }),
    )
    expect(stepOf(result, 'frames')).toMatchObject({ state: 'unknown', progress: null })
    expect(result.nextId).toBe('takes')
  })

  it('Take まで済めば、次は ⑨ 書き出す。書き出しの履歴が読めていなければ「分からない」', () => {
    const result = workflowSteps(allDone({ rendered: false }))
    expect(result.nextId).toBe('render')
    expect(stateOf(workflowSteps(allDone({ rendered: null })), 'render')).toBe('unknown')
  })

  it('全部済めば次は無い', () => {
    const result = workflowSteps(allDone())
    expect(result.steps.every((step) => step.state === 'done')).toBe(true)
    expect(result.nextId).toBeNull()
  })
})

describe('lyricTelopCountOf', () => {
  it('歌詞から置いたテロップ（行の印があるもの）だけを数える。手で置いたテロップや絵の素材は数えない', () => {
    const clips = [
      { content: { type: 'text' as const, params: { text: 'a', lyricLine: 0 } } },
      { content: { type: 'text' as const, params: { text: 'b', lyricLine: 1 } } },
      { content: { type: 'text' as const, params: { text: '手で置いた' } } },
      { content: { type: 'media' as const } },
    ]
    expect(lyricTelopCountOf(clips)).toBe(2)
  })
})
