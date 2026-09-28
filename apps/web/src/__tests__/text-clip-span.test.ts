import { TimelineClip, TimelineClipId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { textClipSpanIssue } from '@/lib/text-clip-span'
import { PROJECT_ID } from './fixtures'

/**
 * インスペクターでテロップの開始・尺を直すときの検査。**帯の小窓と同じ規則**で見る
 * （`validateTextClipInsert`。画面ごとに規則を書き写さない）。
 */

const clip = (id: string, startSec: number, durationSec: number, layer = 0) =>
  TimelineClip.parse({
    id,
    projectId: PROJECT_ID,
    track: 'TEXT',
    startSec,
    durationSec,
    layer,
    content: { type: 'text', templateKey: 'plain', params: { text: id.slice(-1) } },
    opacity: 1,
    createdAt: new Date(),
  })

const own = clip(TimelineClipId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB0'), 1, 2)
const next = clip(TimelineClipId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB1'), 4, 2)
const otherLayer = clip(TimelineClipId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB2'), 0, 10, 1)
const clips = [own, next, otherLayer]
const issueFor = (startSec: number, durationSec: number) =>
  textClipSpanIssue({ clips, clip: own, programEndSec: 60, startSec, durationSec })

describe('textClipSpanIssue', () => {
  it('空いている区間なら保存してよい', () => {
    expect(issueFor(1.5, 2.5)).toBeNull()
  })

  it('自分自身とは重なりを見ない（直しているのだから当然ぶつかる）', () => {
    expect(issueFor(1, 2)).toBeNull()
  })

  it('同じ層の別のテロップと重なるなら止める', () => {
    expect(issueFor(3, 2)).toMatch(/重なります/)
  })

  it('別の層とは重なってよい', () => {
    expect(issueFor(6.5, 1)).toBeNull()
  })

  it('短すぎる尺は止める', () => {
    expect(issueFor(1, 0.2)).toMatch(/以上必要です/)
  })

  it('文字や型が読めないテロップでも、時間だけは直せる', () => {
    const broken = TimelineClip.parse({
      ...own,
      content: { type: 'text', templateKey: 'unknown', params: {} },
    })
    expect(textClipSpanIssue({ clips, clip: broken, programEndSec: 60, startSec: 1.5, durationSec: 2 })).toBeNull()
  })
})
