import { describe, expect, it } from 'vitest'
import { lastActivityLabel, projectProgressLine, showsStatusPill } from '@/lib/project-display'

/**
 * 作品一覧のカードの言葉。どこまで進んだか（Shot・採用した Take・書き出し）と、最後に触った時刻。
 */

const activity = (shotCount: number, adoptedTakeCount: number, hasRender: boolean) => ({
  lastActivityAt: new Date('2026-11-10T05:02:00.000Z'),
  shotCount,
  adoptedTakeCount,
  hasRender,
})

describe('projectProgressLine', () => {
  it('Shot・採用した Take・書き出し済み', () => {
    expect(projectProgressLine('mv', activity(27, 20, true))).toBe('Shot 27・Take 20/27・書き出し済み')
  })

  it('書き出しが終わっていなければ書き出しは言わない', () => {
    expect(projectProgressLine('short', activity(5, 0, false))).toBe('Shot 5・Take 0/5')
  })

  it('Shot が無ければそう言う', () => {
    expect(projectProgressLine('mv', activity(0, 0, false))).toBe('Shot はまだありません')
  })

  it('素材置き場で Shot が無ければ何も言わない', () => {
    expect(projectProgressLine('library', activity(0, 0, false))).toBeNull()
    expect(projectProgressLine('library', activity(2, 1, false))).toBe('Shot 2・Take 1/2')
  })
})

describe('lastActivityLabel', () => {
  it('東京の時刻で「更新」', () => {
    expect(lastActivityLabel(activity(0, 0, false))).toBe('更新 2026/11/10 14:02')
  })
})

describe('showsStatusPill', () => {
  it('はじめの「企画」のままなら出さない', () => {
    expect(showsStatusPill('planning')).toBe(false)
    expect(showsStatusPill('production')).toBe(true)
    expect(showsStatusPill('done')).toBe(true)
  })
})
