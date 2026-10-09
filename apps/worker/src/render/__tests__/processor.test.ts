import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RenderJobId as RenderJobIdSchema, newId, type Project, type RenderJob, type TimelineDocument } from '@ixa/domain'
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
  recordingMediaQueue,
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
  /** media キューへの投入を失敗させる。 */
  readonly mediaQueueFailWith?: Error
  /** 書き出しの音量を揃えるか（無ければ既定の「揃える」）。 */
  readonly normalizeLoudness?: boolean
  /** 揃える口の結果。既定は「音が無い」（偽のレンダラの出力は音を持たない）。 */
  readonly loudness?: 'normalized' | 'no_audio' | Error
  /**
   * 書き出しの直前の拡大（ADR-0045）。既定は「拡大が要らない」（文書をそのまま返す）。
   * `replace` は URL を差し替えた新しい文書を返す。`releaseFails` は片付けだけ失敗する。
   */
  readonly prepare?: 'passthrough' | 'replace' | 'releaseFails' | Error
}

const NORMALIZED_BYTES = Buffer.from('normalized-mp4-bytes')

const buildFixture = async (options: FixtureOptions = {}) => {
  const project = options.project ?? aProject()
  const projects = inMemoryProjects([project])
  const renderJobs = inMemoryRenderJobs()
  const mediaAssets = inMemoryMediaAssets()
  const renderer = createTestRenderer({ outputPath, ...options.renderer })
  const mediaQueue = recordingMediaQueue(options.mediaQueueFailWith)

  const job = await renderJobs.create({
    projectId: project.id,
    scope: { type: 'full' },
    preset: 'master_1080p',
    timelineSnapshot: options.snapshot ?? aTimelineDocument(),
    ...(options.status === undefined ? {} : { status: options.status }),
    ...(options.normalizeLoudness === undefined ? {} : { normalizeLoudness: options.normalizeLoudness }),
  })

  const loudnessCalls: { input: string; output: string; audioBitrate: string }[] = []
  const prepareFrames: { width: number; height: number }[] = []
  const prepared: TimelineDocument[] = []
  let releases = 0
  const deps: RenderProcessorDeps = {
    renderJobs,
    mediaAssets,
    projects,
    storage: createMemoryStorage(),
    renderer,
    mediaQueue,
    logger: silentLogger,
    normalizeLoudness: async (input, output, audioBitrate) => {
      loudnessCalls.push({ input, output, audioBitrate })
      const outcome = options.loudness ?? 'no_audio'
      if (outcome instanceof Error) throw outcome
      if (outcome === 'no_audio') return null
      await writeFile(output, NORMALIZED_BYTES)
      return { integratedLufs: -14.1, truePeakDb: -1.6 }
    },
    prepareMedia: (doc, frame) => {
      prepareFrames.push(frame)
      const mode = options.prepare ?? 'passthrough'
      if (mode instanceof Error) return Promise.reject(mode)
      const document =
        mode === 'replace'
          ? { ...doc, video1: doc.video1.map((entry) => ({ ...entry, mediaUrl: 'http://127.0.0.1:1/up' })) }
          : doc
      prepared.push(document)
      return Promise.resolve({
        document,
        upscaled: mode === 'replace' ? doc.video1.length : 0,
        release: () => {
          releases += 1
          return mode === 'releaseFails' ? Promise.reject(new Error('片付けに失敗')) : Promise.resolve()
        },
      })
    },
  }

  return {
    deps,
    job,
    project,
    projects,
    renderJobs,
    mediaAssets,
    renderer,
    mediaQueue,
    loudnessCalls,
    prepareFrames,
    prepared,
    releases: () => releases,
  }
}

/** 制作者 2026-10-09「時間かけて書き出ししてから保存で失敗すると時間の無駄だし UX 最悪」。 */
describe('processRenderJob の同じ中身の書き出し', () => {
  it('前の書き出しと中身が同じなら、保存で落とさず前の素材を使う', async () => {
    const { deps, job, renderJobs, mediaAssets } = await buildFixture()
    const first = await processRenderJob(deps, { renderJobId: job.id })

    // タイムラインを変えずにもう一度書き出す（同じバイト列になる）。
    const again = await renderJobs.create({
      projectId: job.projectId,
      scope: { type: 'full' },
      preset: 'master_1080p',
      timelineSnapshot: job.timelineSnapshot,
    })
    const second = await processRenderJob(deps, { renderJobId: again.id })

    if (first.state !== 'succeeded' || second.state !== 'succeeded') {
      throw new Error(`両方とも成功するはず: ${first.state} / ${second.state}`)
    }
    expect(second.outputAssetId).toBe(first.outputAssetId)
    expect(mediaAssets.snapshot()).toHaveLength(1)
  })
})

/** ADR-0045 段 3。書き出しの直前に、枠より小さい映像だけ Lanczos で拡大する。 */
describe('processRenderJob の書き出しの直前の拡大', () => {
  it('拡大の段が返した文書を書き出しに渡す。枠はプリセットの大きさ', async () => {
    const { deps, job, renderer, prepared, prepareFrames } = await buildFixture({ prepare: 'replace' })

    const outcome = await processRenderJob(deps, { renderJobId: job.id })

    expect(outcome.state).toBe('succeeded')
    expect(prepareFrames).toEqual([{ width: 1920, height: 1080 }])
    expect(renderer.received()[0]).toBe(prepared[0])
    expect(renderer.received()[0]?.video1[0]?.mediaUrl).toBe('http://127.0.0.1:1/up')
  })

  it('拡大が要らなければ、スナップショットそのものを渡す（今日の書き出しの経路）', async () => {
    const { deps, job, renderer, renderJobs } = await buildFixture()

    await processRenderJob(deps, { renderJobId: job.id })

    expect(renderer.received()[0]).toEqual(renderJobs.snapshot()[0]?.timelineSnapshot)
  })

  it('書き出しが失敗しても一時ファイルを片付ける', async () => {
    const { deps, job, releases } = await buildFixture({
      prepare: 'replace',
      renderer: { failWith: new Error('Chrome が落ちた') },
    })

    const outcome = await processRenderJob(deps, { renderJobId: job.id })

    expect(outcome.state).toBe('failed')
    expect(releases()).toBe(1)
  })

  it('片付けに失敗しても、書き出しの結果は成功のまま', async () => {
    const { deps, job, releases } = await buildFixture({ prepare: 'releaseFails' })

    const outcome = await processRenderJob(deps, { renderJobId: job.id })

    expect(outcome.state).toBe('succeeded')
    expect(releases()).toBe(1)
  })

  it('拡大に失敗したら、書き出しを始めずに failed にする', async () => {
    const { deps, job, renderer } = await buildFixture({ prepare: new Error('ffmpeg が落ちた') })

    const outcome = await processRenderJob(deps, { renderJobId: job.id })

    expect(outcome.state).toBe('failed')
    expect(renderer.calls()).toBe(0)
  })
})

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

/**
 * 再発防止（実データで起きた事故）。
 *
 * render が尺と hasAudio だけの部分的な probe を書いていたため、media 側が
 * `probe !== null` を取り込み済みの根拠にしていた時期にレンダリング結果の
 * media ジョブが必ず skip され、ポスターフレームが 1 枚も作られなかった。
 * skip は成功として返るので、欠落は下流から見えなかった。
 *
 * 根本は「測っていない値を測った形で残したこと」なので、ここで縛る。
 */
describe('出力の probe は測った側が書く', () => {
  it('render は probe を書かない（測っていないため）', async () => {
    const { deps, job, mediaAssets } = await buildFixture()

    await processRenderJob(deps, { renderJobId: job.id })

    expect(mediaAssets.snapshot()[0]?.probe).toBeNull()
  })

  it('レンダラが尺を返しても probe には入れない', async () => {
    const { deps, job, mediaAssets } = await buildFixture({
      renderer: { durationSec: 116.5 },
    })

    await processRenderJob(deps, { renderJobId: job.id })

    // 116.5 は「タイムラインが要求した尺」であって出力ファイルの実測値ではない。
    expect(mediaAssets.snapshot()[0]?.probe).toBeNull()
  })

  it('音声トラックの有無から hasAudio を推測しない', async () => {
    const { deps, job, mediaAssets } = await buildFixture({
      snapshot: aTimelineDocument({
        audio: [{ mediaUrl: 'memory://bgm.mp3', startSec: 0, durationSec: 4, volume: 1 }],
      }),
    })

    await processRenderJob(deps, { renderJobId: job.id })

    expect(mediaAssets.snapshot()[0]?.probe).toBeNull()
  })

  it('派生物の列も空のまま残す（media ジョブが埋める）', async () => {
    const { deps, job, mediaAssets } = await buildFixture()

    await processRenderJob(deps, { renderJobId: job.id })

    const asset = mediaAssets.snapshot()[0]
    expect(asset?.proxyKey).toBeNull()
    expect(asset?.thumbnailKey).toBeNull()
    expect(asset?.posterKeys).toEqual([])
  })
})

describe('出力を media キューへ回す', () => {
  it('成功したら出力 MediaAsset を media キューへ投入する', async () => {
    const { deps, job, mediaQueue, renderJobs } = await buildFixture()

    await processRenderJob(deps, { renderJobId: job.id })

    // ここを通さないと probe もポスターフレームも永久に作られない。
    expect(mediaQueue.enqueued()).toEqual([renderJobs.snapshot()[0]?.outputAssetId])
  })

  it('投入するのは出力 MediaAsset そのもの', async () => {
    const { deps, job, mediaAssets, mediaQueue } = await buildFixture()

    const outcome = await processRenderJob(deps, { renderJobId: job.id })

    expect(outcome).toEqual({ state: 'succeeded', outputAssetId: mediaAssets.snapshot()[0]?.id })
    expect(mediaQueue.enqueued()).toEqual([mediaAssets.snapshot()[0]?.id])
  })

  it('投入に失敗してもレンダリングジョブは succeeded のまま', async () => {
    const { deps, job, renderJobs, mediaAssets } = await buildFixture({
      mediaQueueFailWith: new Error('redis に接続できません'),
    })

    const outcome = await processRenderJob(deps, { renderJobId: job.id })

    // 数十分かけた出力を Redis の不調で捨てない。media ジョブは冪等で流し直せる。
    expect(outcome.state).toBe('succeeded')
    const finished = renderJobs.snapshot()[0]
    expect(finished?.status).toBe('succeeded')
    expect(finished?.error).toBeNull()
    expect(finished?.outputAssetId).toBe(mediaAssets.snapshot()[0]?.id)
  })

  it('レンダリングが失敗したら media キューへは何も投入しない', async () => {
    const { deps, job, mediaQueue } = await buildFixture({
      renderer: { failWith: new Error('Chrome が起動できませんでした') },
    })

    await processRenderJob(deps, { renderJobId: job.id })

    expect(mediaQueue.enqueued()).toEqual([])
  })

  it('終了済みのジョブを再処理しても二重に投入しない', async () => {
    const { deps, job, mediaQueue } = await buildFixture()

    await processRenderJob(deps, { renderJobId: job.id })
    await processRenderJob(deps, { renderJobId: job.id })

    expect(mediaQueue.enqueued()).toHaveLength(1)
  })
})

/** 書き出しの音量を揃える（ADR-0039）。YouTube・SNS の基準（-14 LUFS）に合わせ、測った大きさを記録する。 */
describe('processRenderJob（音量を揃える）', () => {
  it('既定では揃えてから保存し、揃えた後の大きさをジョブに残す（その画質の音のビットレートで）', async () => {
    const { deps, job, project, loudnessCalls, renderJobs } = await buildFixture({ loudness: 'normalized' })

    expect((await processRenderJob(deps, { renderJobId: job.id })).state).toBe('succeeded')

    expect(loudnessCalls).toHaveLength(1)
    expect(loudnessCalls[0]?.input).toBe(outputPath)
    expect(loudnessCalls[0]?.audioBitrate).toMatch(/k$/)
    expect(Buffer.from(await deps.storage.get(renderKey(project.id, job.id, 'mp4')))).toEqual(NORMALIZED_BYTES)
    expect(renderJobs.snapshot()[0]?.loudnessLufs).toBe(-14.1)
  })

  it('揃えないと選んだ書き出しは、そのまま保存する', async () => {
    const { deps, job, project, loudnessCalls, renderJobs } = await buildFixture({ normalizeLoudness: false, loudness: 'normalized' })

    await processRenderJob(deps, { renderJobId: job.id })

    expect(loudnessCalls).toHaveLength(0)
    expect(Buffer.from(await deps.storage.get(renderKey(project.id, job.id, 'mp4')))).toEqual(OUTPUT_BYTES)
    expect(renderJobs.snapshot()[0]?.loudnessLufs).toBeNull()
  })

  it('音が無い（揃える音が無い）書き出しは、そのまま保存する', async () => {
    const { deps, job, project } = await buildFixture({ loudness: 'no_audio' })

    expect((await processRenderJob(deps, { renderJobId: job.id })).state).toBe('succeeded')
    expect(Buffer.from(await deps.storage.get(renderKey(project.id, job.id, 'mp4')))).toEqual(OUTPUT_BYTES)
  })

  it('揃えられなければ、黙って揃えないまま出さず、理由を残して失敗にする', async () => {
    const { deps, job, renderJobs } = await buildFixture({ loudness: new Error('loudnorm が失敗しました') })

    expect((await processRenderJob(deps, { renderJobId: job.id })).state).toBe('failed')
    expect(renderJobs.snapshot()[0]?.error).toMatch(/音量を揃えられませんでした/)
  })
})
