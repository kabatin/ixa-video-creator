import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RenderJobId as RenderJobIdSchema, newId, type Project, type RenderJob } from '@ixa/domain'
import { createMemoryStorage, renderKey } from '@ixa/storage'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { processRenderJob, type RenderProcessorDeps } from '../processor.js'
import {
  aProject,
  aTimelineDocument,
  createTestRenderer,
  inMemoryMediaAssets,
  inMemoryProjects,
  inMemoryRenderJobs,
  silentLogger,
  type TestRendererOptions,
} from './doubles.js'

/**
 * render キューのジョブ処理の検証。
 * 実 DB / 実ストレージには接続せず、Remotion の実レンダリングもしない。
 */

const OUTPUT_BYTES = Buffer.from('rendered-mp4-bytes')
let outputDir: string
let outputPath: string

beforeAll(async () => {
  outputDir = await mkdtemp(join(tmpdir(), 'ixa-render-test-'))
  outputPath = join(outputDir, 'render-master_1080p.mp4')
  await writeFile(outputPath, OUTPUT_BYTES)
})

afterAll(async () => {
  await rm(outputDir, { recursive: true, force: true })
})

type FixtureOptions = {
  readonly project?: Project
  readonly status?: RenderJob['status']
  readonly snapshot?: ReturnType<typeof aTimelineDocument>
  readonly renderer?: Partial<TestRendererOptions>
}

const buildFixture = async (options: FixtureOptions = {}) => {
  const project = options.project ?? aProject()
  const projects = inMemoryProjects([project])
  const renderJobs = inMemoryRenderJobs()
  const mediaAssets = inMemoryMediaAssets()
  const renderer = createTestRenderer({ outputPath, ...options.renderer })

  const job = await renderJobs.create({
    projectId: project.id,
    scope: { type: 'full' },
    preset: 'master_1080p',
    timelineSnapshot: options.snapshot ?? aTimelineDocument(),
    ...(options.status === undefined ? {} : { status: options.status }),
  })

  const deps: RenderProcessorDeps = {
    renderJobs,
    mediaAssets,
    projects,
    storage: createMemoryStorage(),
    renderer,
    logger: silentLogger,
  }

  return { deps, job, project, projects, renderJobs, mediaAssets, renderer }
}

describe('processRenderJob', () => {
  it('レンダリングして出力を保存し、RenderJob を succeeded にする', async () => {
    const { deps, job, project, renderJobs, mediaAssets } = await buildFixture()

    const outcome = await processRenderJob(deps, { renderJobId: job.id })

    expect(outcome.state).toBe('succeeded')

    const asset = mediaAssets.snapshot()[0]
    expect(mediaAssets.snapshot()).toHaveLength(1)
    expect(asset?.origin).toEqual({ type: 'rendered', renderJobId: job.id })
    expect(asset?.storageKey).toBe(renderKey(project.id, job.id, 'mp4'))
    expect(asset?.mimeType).toBe('video/mp4')
    expect(asset?.bytes).toBe(OUTPUT_BYTES.byteLength)

    const updated = renderJobs.snapshot()[0]
    expect(updated?.status).toBe('succeeded')
    expect(updated?.progress).toBe(1)
    expect(updated?.outputAssetId).toBe(asset?.id)
    expect(updated?.finishedAt).not.toBeNull()
  })

  it('出力バイト列をストレージへ格納する', async () => {
    const { deps, job, project } = await buildFixture()

    await processRenderJob(deps, { renderJobId: job.id })

    const stored = await deps.storage.get(renderKey(project.id, job.id, 'mp4'))
    expect(Buffer.from(stored).toString()).toBe(OUTPUT_BYTES.toString())
  })

  it('ジョブデータは renderJobId のみで、実データは DB から読む', async () => {
    const { deps, job, renderer } = await buildFixture({
      snapshot: aTimelineDocument({ durationSec: 42 }),
    })

    await processRenderJob(deps, { renderJobId: job.id })

    // scope / preset / タイムラインはジョブデータに無く、DB の行から来ている。
    expect(renderer.received()[0]?.durationSec).toBe(42)
  })

  it('renderJobId 以外の形のジョブデータは弾く', async () => {
    const { deps } = await buildFixture()

    await expect(processRenderJob(deps, { foo: 'bar' })).rejects.toThrow()
  })

  it('存在しない RenderJob は例外にする', async () => {
    const { deps } = await buildFixture()

    await expect(
      processRenderJob(deps, { renderJobId: newId(RenderJobIdSchema) }),
    ).rejects.toThrow('RenderJob が見つかりません')
  })
})

describe('timelineSnapshot を使い、DB から再構築しない', () => {
  it('投入後に Project を変更しても、レンダラが受け取る内容は変わらない', async () => {
    const project = aProject({ fps: 30, resolution: { width: 1920, height: 1080 } })
    const snapshot = aTimelineDocument({
      fps: 30,
      resolution: { width: 1920, height: 1080 },
      durationSec: 4,
    })
    const { deps, job, projects, renderer } = await buildFixture({ project, snapshot })

    // 投入後に出力仕様を変える。再構築するなら 60fps / 4K の doc になるはず。
    projects.replace({ ...project, fps: 60, resolution: { width: 3840, height: 2160 } })

    await processRenderJob(deps, { renderJobId: job.id })

    const received = renderer.received()[0]
    expect(received?.fps).toBe(30)
    expect(received?.resolution).toEqual({ width: 1920, height: 1080 })
    // 保存されたスナップショットとまったく同じものが渡る。
    expect(received).toEqual(snapshot)
  })

  it('投入後に Shot 相当の内容が変わっても出力が変わらない（スナップショットが正）', async () => {
    const snapshot = aTimelineDocument({ durationSec: 4 })
    const { deps, job, renderJobs, renderer } = await buildFixture({ snapshot })

    // RenderJob の更新口には timelineSnapshot が無い。投入後は誰も差し替えられない。
    await renderJobs.update(job.id, { progress: 0.5 })

    await processRenderJob(deps, { renderJobId: job.id })

    expect(renderer.received()[0]?.video1).toEqual(snapshot.video1)
    expect(renderJobs.snapshot()[0]?.timelineSnapshot).toEqual(snapshot)
  })
})

describe('進捗の間引き', () => {
  it('onProgress を 100 回呼んでも DB 更新は数回で済む', async () => {
    const { deps, job, renderJobs } = await buildFixture({
      // 長尺のレンダリングを模す。100 フレームで全体の 5% しか進まない。
      renderer: { progressSteps: 100, progressMax: 0.05 },
    })

    await processRenderJob(deps, { renderJobId: job.id })

    const progressUpdates = renderJobs
      .updates()
      .filter((patch) => patch.progress !== undefined && patch.status === undefined)

    expect(progressUpdates.length).toBeLessThanOrEqual(10)
    expect(progressUpdates.length).toBeGreaterThan(0)
    // 最終状態は succeeded / progress=1 で確定する。
    expect(renderJobs.snapshot()[0]?.progress).toBe(1)
  })

  it('間引いても進捗は単調に増える', async () => {
    const { deps, job, renderJobs } = await buildFixture({
      renderer: { progressSteps: 100, progressMax: 1 },
    })

    await processRenderJob(deps, { renderJobId: job.id })

    const values = renderJobs
      .updates()
      .flatMap((patch) => (typeof patch.progress === 'number' ? [patch.progress] : []))

    expect(values).toEqual([...values].sort((a, b) => a - b))
  })
})

describe('冪等性', () => {
  it.each(['succeeded', 'failed', 'cancelled'] as const)(
    '終了済み（%s）のジョブは何もせずに返す',
    async (status) => {
      const { deps, job, mediaAssets, renderer } = await buildFixture({ status })

      const outcome = await processRenderJob(deps, { renderJobId: job.id })

      expect(outcome).toEqual({ state: 'skipped', reason: `status=${status}` })
      expect(renderer.calls()).toBe(0)
      expect(mediaAssets.snapshot()).toHaveLength(0)
    },
  )

  it('成功したジョブを再処理しても MediaAsset が増えない', async () => {
    const { deps, job, mediaAssets } = await buildFixture()

    await processRenderJob(deps, { renderJobId: job.id })
    expect(mediaAssets.snapshot()).toHaveLength(1)

    const second = await processRenderJob(deps, { renderJobId: job.id })

    expect(second.state).toBe('skipped')
    expect(mediaAssets.snapshot()).toHaveLength(1)
  })
})

describe('失敗の記録', () => {
  it('レンダラが失敗したら RenderJob.error に理由を残す', async () => {
    const { deps, job, renderJobs, mediaAssets } = await buildFixture({
      renderer: { failWith: new Error('Chrome が起動できませんでした') },
    })

    const outcome = await processRenderJob(deps, { renderJobId: job.id })

    expect(outcome).toEqual({ state: 'failed', message: 'Chrome が起動できませんでした' })

    const failed = renderJobs.snapshot()[0]
    expect(failed?.status).toBe('failed')
    expect(failed?.error).toBe('Chrome が起動できませんでした')
    expect(failed?.finishedAt).not.toBeNull()
    expect(mediaAssets.snapshot()).toHaveLength(0)
  })

  it('Project が消えていたら failed にする', async () => {
    const project = aProject()
    const { deps, job, renderJobs } = await buildFixture({ project })
    // Project を引けないリポジトリに差し替える。
    const brokenDeps: RenderProcessorDeps = { ...deps, projects: inMemoryProjects([]) }

    const outcome = await processRenderJob(brokenDeps, { renderJobId: job.id })

    expect(outcome.state).toBe('failed')
    expect(renderJobs.snapshot()[0]?.error).toContain('Project がありません')
  })

  it('失敗してもそこまでの進捗は書き切る', async () => {
    const { deps, job, renderJobs } = await buildFixture({
      renderer: { progressSteps: 100, progressMax: 1, failWith: new Error('途中で落ちた') },
    })

    await processRenderJob(deps, { renderJobId: job.id })

    const progressUpdates = renderJobs
      .updates()
      .filter((patch) => patch.progress !== undefined && patch.status === undefined)

    expect(progressUpdates.length).toBeGreaterThan(0)
  })
})
