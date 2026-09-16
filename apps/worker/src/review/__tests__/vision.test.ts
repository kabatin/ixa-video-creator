import { createMemoryStorage } from '@ixa/storage'
import { describe, expect, it } from 'vitest'
import { MAX_SUBJECT_FRAMES, VisionStageError, buildCriteria, runVisionStage } from '../vision.js'
import {
  aProject,
  aShot,
  aVideoAsset,
  fakeVisionReviewer,
  silentLogger,
} from './doubles.js'

const project = aProject()
const shot = aShot(project)

describe('buildCriteria', () => {
  it('Shot の演出指示を判定基準に落とす', () => {
    const criteria = buildCriteria(shot)
    expect(criteria).toContain('shot_001')
    expect(criteria).toContain('ステージ中央でボーカルが歌い出す')
    expect(criteria).toContain('medium')
  })

  it('description が空でも空文字にはならない', () => {
    expect(buildCriteria(aShot(project, { description: '' })).length).toBeGreaterThan(0)
  })
})

describe('runVisionStage', () => {
  const base = { shot, storage: createMemoryStorage(), logger: silentLogger }

  it('ポスターフレームを署名付き URL にして渡す', async () => {
    const reviewer = fakeVisionReviewer()
    const asset = aVideoAsset(project)

    await runVisionStage({ ...base, asset, reviewers: [reviewer] })

    const request = reviewer.calls()[0]
    expect(request?.subjects).toHaveLength(MAX_SUBJECT_FRAMES)
    expect(request?.subjects[0]?.url).toContain('op=get')
    expect(request?.subjects[0]?.label).toMatch(/^frame@/)
  })

  it('supports に挙げた種別ごとに 1 回ずつ呼ぶ', async () => {
    const reviewer = fakeVisionReviewer({ supports: ['identity', 'composition'] })
    const result = await runVisionStage({
      ...base,
      asset: aVideoAsset(project),
      reviewers: [reviewer],
    })

    expect(reviewer.calls().map((call) => call.reviewer)).toEqual(['identity', 'composition'])
    expect(result.findings.map((f) => f.reviewer)).toEqual(['identity', 'composition'])
    expect(result.costUsd).toBeCloseTo(0.04)
  })

  it('ポスターフレームが無ければサムネイルで代替する', async () => {
    const reviewer = fakeVisionReviewer()
    const asset = aVideoAsset(project, { posterKeys: [], thumbnailKey: 'media/thumb.jpg' })

    await runVisionStage({ ...base, asset, reviewers: [reviewer] })

    expect(reviewer.calls()[0]?.subjects).toHaveLength(1)
  })

  it('判定できるフレームが 1 枚も無ければ呼ばない（課金しない）', async () => {
    const reviewer = fakeVisionReviewer()
    const asset = aVideoAsset(project, { posterKeys: [], thumbnailKey: null })

    const result = await runVisionStage({ ...base, asset, reviewers: [reviewer] })

    expect(reviewer.calls()).toHaveLength(0)
    expect(result).toEqual({ findings: [], costUsd: 0 })
  })

  it('失敗したときは、そこまでのコストを持った例外を投げる', async () => {
    const ok = fakeVisionReviewer({ name: 'ok', supports: ['identity'], costUsd: 0.03 })
    const broken = fakeVisionReviewer({
      name: 'broken',
      supports: ['continuity'],
      fail: new Error('LLM が 500 を返しました'),
    })

    const failure = await runVisionStage({
      ...base,
      asset: aVideoAsset(project),
      reviewers: [ok, broken],
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(VisionStageError)
    expect((failure as VisionStageError).costUsd).toBeCloseTo(0.03)
    expect((failure as VisionStageError).cause).toBeInstanceOf(Error)
  })
})
