import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MOTION_ANALYZER_VERSION,
  newId,
  TakeId as TakeIdSchema,
  TakeMotionAnalysisId,
  type AiToolId,
  type CreateMotionAnalysisInput,
  type MotionAnalysis,
  type MotionEvent,
} from '@ixa/domain'
import type { MotionVisionAnalyzer, MotionVisionRequest } from '@ixa/provider-llm'
import { describe, expect, it } from 'vitest'
import {
  aProject,
  aShot,
  aTake,
  aVideoAsset,
  inMemoryMediaAssets,
  inMemoryShots,
  inMemoryTakes,
  silentLogger,
} from '../../review/__tests__/doubles.js'
import type { MotionMeasurement, MotionMeasurer } from '../measure.js'
import { processMotionJob, type MotionProcessorDeps } from '../processor.js'

/** Take の動きの分析（ADR-0054）。ffmpeg と Claude は差し替え、流れと残す行を確かめる。 */

const HOP = 1 / 12
/** 1 秒・2 秒・3 秒に山がある 4 秒の Take。 */
const energy = Array.from({ length: 48 }, (_, i) => (i === 12 || i === 24 || i === 36 ? 0.06 : 0.01))

const measurement: MotionMeasurement = {
  durationSec: 4,
  energyHopSec: HOP,
  energy,
  strip: { path: '/tmp/strip.jpg', columns: 4, frameTimesSec: [0.5, 1.5, 2.5, 3.5] },
}

const landing = (takeStartSec: number): MotionEvent => ({
  kind: 'moment',
  takeStartSec,
  takeDurationSec: 0.4,
  label: '着地',
  sfxPrompt: 'cartoon boing bounce landing',
  confidence: 0.8,
})

type FakeVision = MotionVisionAnalyzer & { readonly requests: MotionVisionRequest[] }

const fakeVision = (events: readonly MotionEvent[] | Error): FakeVision => {
  const requests: MotionVisionRequest[] = []
  return {
    name: 'fake-motion-vision',
    requests,
    analyze: (request) => {
      requests.push(request)
      return events instanceof Error ? Promise.reject(events) : Promise.resolve({ events, costUsd: 0.05 })
    },
  }
}

const inMemoryAnalyses = (seed: readonly MotionAnalysis[] = []) => {
  const rows: MotionAnalysis[] = [...seed]
  return {
    rows,
    findLatestByTake: (takeId: MotionAnalysis['takeId']) =>
      Promise.resolve([...rows].reverse().find((row) => row.takeId === takeId) ?? null),
    create: (input: CreateMotionAnalysisInput) => {
      const row = { ...input, id: newId(TakeMotionAnalysisId), createdAt: new Date() }
      rows.push(row)
      return Promise.resolve(row)
    },
  }
}

type Options = {
  readonly tool?: AiToolId
  readonly vision?: FakeVision
  readonly measurer?: MotionMeasurer
  readonly seed?: (takeId: MotionAnalysis['takeId']) => readonly MotionAnalysis[]
}

const harness = (options: Options = {}) => {
  const project = aProject()
  const shot = aShot(project, { description: '戦子が跳ねる' })
  const asset = aVideoAsset(project)
  const take = aTake(shot, asset.id)
  const analyses = inMemoryAnalyses(options.seed?.(take.id) ?? [])
  const vision = options.vision ?? fakeVision([landing(1.1), landing(1.9)])
  const measured: string[] = []
  const deps: MotionProcessorDeps = {
    takes: inMemoryTakes([take]),
    shots: inMemoryShots([shot]),
    mediaAssets: inMemoryMediaAssets([asset]),
    analyses,
    measurer:
      options.measurer ??
      ((measuredAsset) => {
        measured.push(measuredAsset.id)
        return Promise.resolve(measurement)
      }),
    vision,
    textTool: () => Promise.resolve(options.tool ?? 'claude_cli'),
    workDir: join(tmpdir(), 'ixa-motion-processor-test'),
    logger: silentLogger,
  }
  return { deps, take, analyses, vision, measured }
}

describe('processMotionJob', () => {
  it('ジョブデータを zod で検証する', async () => {
    const { deps } = harness()
    await expect(processMotionJob(deps, { takeId: 'nope' })).rejects.toThrow()
  })

  it('Take が無ければ投げる（ジョブが実在しない行を指している）', async () => {
    const { deps } = harness()
    await expect(processMotionJob(deps, { takeId: newId(TakeIdSchema) })).rejects.toThrow(/Take/)
  })

  it('Claude を選んでいれば、山と帯を見せ、瞬間の時刻を山に寄せて残す', async () => {
    const { deps, take, analyses, vision } = harness()
    const outcome = await processMotionJob(deps, { takeId: take.id })
    expect(outcome.state).toBe('analyzed')
    expect(vision.requests[0]?.onsets.map((o) => Number(o.atSec.toFixed(3)))).toEqual([1, 2, 3])
    expect(vision.requests[0]?.description).toBe('戦子が跳ねる')
    expect(vision.requests[0]?.frameTimesSec).toEqual([0.5, 1.5, 2.5, 3.5])
    const row = analyses.rows[0]
    expect(row).toMatchObject({ status: 'succeeded', visionUsed: true, costUsd: 0.05, analyzerVersion: MOTION_ANALYZER_VERSION })
    expect(row?.events.map((e) => Number(e.takeStartSec.toFixed(3)))).toEqual([1, 2])
    expect(row?.energy).toEqual(energy)
  })

  it('Claude 以外なら AI を呼ばず、山を瞬間の案にして「見ていない」と残す', async () => {
    const { deps, take, analyses, vision } = harness({ tool: 'codex_cli' })
    await processMotionJob(deps, { takeId: take.id })
    expect(vision.requests).toHaveLength(0)
    expect(analyses.rows[0]).toMatchObject({ status: 'succeeded', visionUsed: false, costUsd: 0 })
    expect(analyses.rows[0]?.events).toHaveLength(3)
  })

  it('Take の外の時刻は落とす', async () => {
    const { deps, take, analyses } = harness({ vision: fakeVision([landing(1), landing(4.5)]) })
    await processMotionJob(deps, { takeId: take.id })
    expect(analyses.rows[0]?.events).toHaveLength(1)
  })

  it('同じ版で成功していれば測らない', async () => {
    const done = (takeId: MotionAnalysis['takeId']): readonly MotionAnalysis[] => [
      {
        id: newId(TakeMotionAnalysisId),
        takeId,
        analyzerVersion: MOTION_ANALYZER_VERSION,
        status: 'succeeded',
        energyHopSec: HOP,
        energy: [],
        onsets: [],
        events: [],
        visionUsed: true,
        costUsd: 0,
        failureMessage: null,
        createdAt: new Date(),
      },
    ]
    const { deps, take, analyses, measured } = harness({ seed: done })
    const outcome = await processMotionJob(deps, { takeId: take.id })
    expect(outcome.state).toBe('skipped')
    expect(measured).toHaveLength(0)
    expect(analyses.rows).toHaveLength(1)
  })

  it('AI が落ちたら、理由を付けた失敗の行を残す（握り潰さない）', async () => {
    const { deps, take, analyses } = harness({ vision: fakeVision(new Error('cli exploded')) })
    const outcome = await processMotionJob(deps, { takeId: take.id })
    expect(outcome.state).toBe('failed')
    expect(analyses.rows[0]?.status).toBe('failed')
    expect(analyses.rows[0]?.failureMessage).toMatch(/AI/)
    expect(analyses.rows[0]?.failureMessage).not.toContain('exploded')
  })

  it('測定が落ちたら、失敗の行を残す', async () => {
    const { deps, take, analyses } = harness({ measurer: () => Promise.reject(new Error('ffmpeg died')) })
    const outcome = await processMotionJob(deps, { takeId: take.id })
    expect(outcome.state).toBe('failed')
    expect(analyses.rows[0]?.failureMessage).toMatch(/動画/)
  })
})
