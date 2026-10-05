import { describe, expect, it } from 'vitest'
import {
  DUPLICATION_ITEMS,
  DuplicateProjectRequest,
  duplicateProjectName,
  duplicationProblem,
  missingRequirements,
  settleDuplicationItems,
  type DuplicationItem,
} from '../project/duplication-options.js'

/**
 * 作品を複製するときに持っていく項目と、その依存（制作者 2026-10-04「持って行きたいところだけ持っていけるようにすると超便利」）。
 * 画面の「押せない理由」と API の 422 が同じ判定を使う。
 */

const all = (): ReadonlySet<DuplicationItem> => new Set(DUPLICATION_ITEMS)
const without = (...items: DuplicationItem[]): ReadonlySet<DuplicationItem> =>
  new Set(DUPLICATION_ITEMS.filter((item) => !items.includes(item)))

describe('missingRequirements', () => {
  it('歌詞の時刻には、楽曲と作品の方針（歌詞）が要る', () => {
    expect(missingRequirements('lyricTiming', without('music'))).toEqual(['music'])
    expect(missingRequirements('lyricTiming', without('music', 'concept'))).toEqual(['music', 'concept'])
    expect(missingRequirements('lyricTiming', all())).toEqual([])
  })

  it('絵コンテ・絵・Take には Shot が要る', () => {
    for (const item of ['storyboard', 'frames', 'takes'] as const) {
      expect(missingRequirements(item, without('shots'))).toEqual(['shots'])
    }
  })

  it('ナレーション（原稿・声の Take）には声が要る（ADR-0038）', () => {
    expect(missingRequirements('narration', without('voices'))).toEqual(['voices'])
    expect(missingRequirements('narration', all())).toEqual([])
  })

  it('依存の無い項目は、何も要らない', () => {
    expect(missingRequirements('characters', new Set())).toEqual([])
    expect(missingRequirements('telops', new Set())).toEqual([])
  })
})

describe('settleDuplicationItems', () => {
  it('Shot を外すと、絵コンテ・絵・Take も外れる', () => {
    const settled = settleDuplicationItems(without('shots'))

    expect([...settled].sort()).toEqual([...without('shots', 'storyboard', 'frames', 'takes')].sort())
  })

  it('声を外すと、ナレーションも外れる（ほかは残る）', () => {
    const settled = settleDuplicationItems(without('voices'))

    expect(settled.has('narration')).toBe(false)
    expect(settled.has('telops')).toBe(true)
  })

  it('楽曲を外すと、歌詞の時刻も外れる（ほかは残る）', () => {
    const settled = settleDuplicationItems(without('music'))

    expect(settled.has('lyricTiming')).toBe(false)
    expect(settled.has('concept')).toBe(true)
    expect(settled.has('telops')).toBe(true)
  })

  it('全部そろっていればそのまま。新しい集合を返す（渡したものを変えない）', () => {
    const selected = all()
    const settled = settleDuplicationItems(selected)

    expect(settled).not.toBe(selected)
    expect(settled.size).toBe(DUPLICATION_ITEMS.length)
  })
})

describe('duplicationProblem', () => {
  it('依存が欠けた選び方は、何が要るかを言う', () => {
    expect(duplicationProblem(['takes'])).toBe('Take を持っていくには、Shot も選んでください')
    expect(duplicationProblem(['lyricTiming'])).toBe('歌詞の時刻を持っていくには、楽曲（解析・セクションも）と作品の方針も選んでください')
  })

  it('そろっていれば null。何も選ばなくても名前と画面の形は写せるので null', () => {
    expect(duplicationProblem([...DUPLICATION_ITEMS])).toBeNull()
    expect(duplicationProblem([])).toBeNull()
  })
})

describe('DuplicateProjectRequest', () => {
  it('名前の前後の空白を落とし、空の名前と同じ項目の重複を断る', () => {
    expect(DuplicateProjectRequest.parse({ name: '  新しい作品 ', items: ['music'] }).name).toBe('新しい作品')
    expect(DuplicateProjectRequest.safeParse({ name: '   ', items: [] }).success).toBe(false)
    expect(DuplicateProjectRequest.safeParse({ name: 'x', items: ['music', 'music'] }).success).toBe(false)
    expect(DuplicateProjectRequest.safeParse({ name: 'x', items: ['unknown'] }).success).toBe(false)
  })
})

describe('duplicateProjectName', () => {
  it('「<元の名前>のコピー」にする', () => {
    expect(duplicateProjectName('進め！戦子ちゃん！')).toBe('進め！戦子ちゃん！のコピー')
  })

  it('名前の上限（200 文字）を超えないよう、元の名前の方を詰める', () => {
    const long = 'あ'.repeat(200)
    const copied = duplicateProjectName(long)

    expect(copied.length).toBe(200)
    expect(copied.endsWith('のコピー')).toBe(true)
  })
})
