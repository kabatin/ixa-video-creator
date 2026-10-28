import type { AiSettings } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { createChosenVisionReviewer } from '../chosen-reviewer.js'
import { fakeVisionReviewer } from './doubles.js'

/**
 * 自動レビューを実際の AI で（制作者 2026-10-01「自動レビューの繋ぎ」）。
 * 動画のチェックを入れていて（ADR-0066。既定は切る）、「使う AI」のテキストが Claude なら画像を見る Claude のレビュー、
 * それ以外はお試し。**判定するたびに選択を読む。**
 */

const request = {
  reviewer: 'identity' as const,
  subjects: [{ label: 'frame@1.000s', path: '/tmp/ixa-review-work/vision-x/frame-0.jpg' }],
  references: [],
  criteria: 'shot shot_001',
  imageDir: '/tmp/ixa-review-work/vision-x',
}

type Choice = Pick<AiSettings, 'text' | 'checks'>
const ON = { image: false, video: true }
const OFF = { image: true, video: false }
const choice = (text: Choice['text'], checks = ON): Choice => ({ text, checks })

const build = (choices: readonly Choice[]) => {
  const claude = fakeVisionReviewer({ name: 'claude' })
  const stub = fakeVisionReviewer({ name: 'stub' })
  let index = 0
  const reviewer = createChosenVisionReviewer({
    checkSettings: () => {
      const current = choices[Math.min(index, choices.length - 1)] ?? choice('stub')
      index += 1
      return Promise.resolve(current)
    },
    claude,
    stub,
  })
  return { reviewer, claude, stub }
}

describe('createChosenVisionReviewer', () => {
  it('テキストの AI が Claude なら、Claude のレビューで判定する', async () => {
    const f = build([choice('claude_cli')])

    await f.reviewer.review(request)

    expect(f.claude.calls()).toHaveLength(1)
    expect(f.stub.calls()).toHaveLength(0)
  })

  it('それ以外（お試し・まだ判定に使えない AI）はお試しで判定する', async () => {
    const f = build([choice('stub')])

    await f.reviewer.review(request)

    expect(f.stub.calls()).toHaveLength(1)
    expect(f.claude.calls()).toHaveLength(0)
  })

  /** 絵のチェックだけ入れても、Take は Claude に見せない（絵と Take は別々）。 */
  it('動画のチェックを切っていれば、Claude を選んでいてもお試しで判定する（Claude の利用枠を使わない）', async () => {
    const f = build([choice('claude_cli', OFF)])

    await f.reviewer.review(request)

    expect(f.claude.calls()).toHaveLength(0)
    expect(f.stub.calls()).toHaveLength(1)
  })

  it('動画のチェックを入れていても、テキストの AI が Claude でなければお試しで判定する', async () => {
    const f = build([choice('codex_cli', ON)])

    await f.reviewer.review(request)

    expect(f.claude.calls()).toHaveLength(0)
    expect(f.stub.calls()).toHaveLength(1)
  })

  it('動画のチェックの入り切りも判定するたびに読む', async () => {
    const f = build([choice('claude_cli', OFF), choice('claude_cli', ON)])

    await f.reviewer.review(request)
    await f.reviewer.review(request)

    expect(f.stub.calls()).toHaveLength(1)
    expect(f.claude.calls()).toHaveLength(1)
  })

  it('判定するたびに選択を読む（画面で選び直したら次の 1 回から効く）', async () => {
    const f = build([choice('stub'), choice('claude_cli')])

    await f.reviewer.review(request)
    await f.reviewer.review(request)

    expect(f.stub.calls()).toHaveLength(1)
    expect(f.claude.calls()).toHaveLength(1)
  })
})
