import type { AiToolId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { createChosenVisionReviewer } from '../chosen-reviewer.js'
import { fakeVisionReviewer } from './doubles.js'

/**
 * 自動レビューを実際の AI で（制作者 2026-10-01「自動レビューの繋ぎ」）。
 * 「使う AI」のテキストが Claude なら画像を見る Claude のレビュー、それ以外はお試し。**判定するたびに選択を読む。**
 */

const request = {
  reviewer: 'identity' as const,
  subjects: [{ label: 'frame@1.000s', path: '/tmp/ixa-review-work/vision-x/frame-0.jpg' }],
  references: [],
  criteria: 'shot shot_001',
  imageDir: '/tmp/ixa-review-work/vision-x',
}

const build = (tools: readonly AiToolId[]) => {
  const claude = fakeVisionReviewer({ name: 'claude' })
  const stub = fakeVisionReviewer({ name: 'stub' })
  let index = 0
  const reviewer = createChosenVisionReviewer({
    textTool: () => {
      const tool = tools[Math.min(index, tools.length - 1)] ?? 'stub'
      index += 1
      return Promise.resolve(tool)
    },
    claude,
    stub,
  })
  return { reviewer, claude, stub }
}

describe('createChosenVisionReviewer', () => {
  it('テキストの AI が Claude なら、Claude のレビューで判定する', async () => {
    const f = build(['claude_cli'])

    await f.reviewer.review(request)

    expect(f.claude.calls()).toHaveLength(1)
    expect(f.stub.calls()).toHaveLength(0)
  })

  it('それ以外（お試し・まだ判定に使えない AI）はお試しで判定する', async () => {
    const f = build(['stub'])

    await f.reviewer.review(request)

    expect(f.stub.calls()).toHaveLength(1)
    expect(f.claude.calls()).toHaveLength(0)
  })

  it('判定するたびに選択を読む（画面で選び直したら次の 1 回から効く）', async () => {
    const f = build(['stub', 'claude_cli'])

    await f.reviewer.review(request)
    await f.reviewer.review(request)

    expect(f.stub.calls()).toHaveLength(1)
    expect(f.claude.calls()).toHaveLength(1)
  })
})
