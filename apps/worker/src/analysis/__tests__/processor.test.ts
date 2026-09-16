import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MANUAL_ANALYZER_VERSION,
  MusicTrackId as MusicTrackIdSchema,
  newId,
  type MusicAnalysis,
  type MusicTrackId,
} from '@ixa/domain'
import { createMemoryStorage, waveformKey, type ObjectStorage } from '@ixa/storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_ANALYZER_VERSION,
  processAnalysisJob,
  type AnalysisProcessorDeps,
} from '../processor.js'
import {
  aMusicTrack,
  anAnalysis,
  anAudioAsset,
  analysisResult,
  fakeAnalyzer,
  inMemoryMediaAssets,
  inMemoryMusicAnalyses,
  inMemoryMusicTracks,
  putAudio,
  silentLogger,
  type FakeAnalyzer,
  type InMemoryMusicAnalyses,
} from './doubles.js'

/**
 * AUDIO_ROOT は実ファイルシステム上のディレクトリでなければならない
 * （worker が音源を書き出し、apps/audio が同じ場所を読む）。
 * 外部サービスには一切繋がず、一時ディレクトリだけを実物にする。
 */
let audioRoot: string

beforeEach(async () => {
  audioRoot = await mkdtemp(join(tmpdir(), 'ixa-analysis-test-'))
})

afterEach(async () => {
  await rm(audioRoot, { recursive: true, force: true })
})

type Harness = {
  readonly deps: AnalysisProcessorDeps
  readonly analyses: InMemoryMusicAnalyses
  readonly analyzer: FakeAnalyzer
  readonly storage: ObjectStorage
  readonly track: ReturnType<typeof aMusicTrack>
}

type HarnessOptions = {
  /** 既存の解析。対象 MusicTrack の id を受け取って作る。 */
  readonly seed?: (musicTrackId: MusicTrackId) => readonly MusicAnalysis[]
  readonly analyzer?: FakeAnalyzer
  /** false にすると音源の実体をストレージへ置かない。 */
  readonly withAudio?: boolean
  /** false にすると MediaAsset を登録しない。 */
  readonly withAsset?: boolean
}

const harness = async (options: HarnessOptions = {}): Promise<Harness> => {
  const track = aMusicTrack()
  const asset = anAudioAsset(track.mediaAssetId)

  const tracks = inMemoryMusicTracks()
  tracks.add(track)

  const mediaAssets = inMemoryMediaAssets()
  if (options.withAsset !== false) mediaAssets.add(asset)

  const storage = createMemoryStorage()
  if (options.withAudio !== false) await putAudio(storage, asset)

  const analyses = inMemoryMusicAnalyses(options.seed?.(track.id) ?? [])
  const analyzer = options.analyzer ?? fakeAnalyzer()

  return {
    track,
    analyses,
    analyzer,
    storage,
    deps: {
      musicTracks: tracks,
      musicAnalyses: analyses,
      mediaAssets,
      storage,
      analyzer,
      audioRoot,
      logger: silentLogger,
    },
  }
}

describe('processAnalysisJob', () => {
  it('解析結果を保存し、波形ピークをストレージへ置く', async () => {
    const { deps, analyses, analyzer, storage, track } = await harness()

    const outcome = await processAnalysisJob(deps, { musicTrackId: track.id })

    expect(outcome.state).toBe('analyzed')
    expect(analyses.snapshot()).toHaveLength(1)

    const saved = analyses.snapshot()[0]
    expect(saved?.musicTrackId).toBe(track.id)
    expect(saved?.analyzerVersion).toBe(DEFAULT_ANALYZER_VERSION)
    expect(saved?.bpm).toBeCloseTo(119.9984)
    expect(saved?.durationSec).toBe(116)
    expect(saved?.sections).toHaveLength(1)

    const key = waveformKey(track.projectId, track.id)
    expect(saved?.waveformPeaksKey).toBe(key)
    const stored: unknown = JSON.parse(new TextDecoder().decode(await storage.get(key)))
    expect(stored).toEqual({ peaks: [0, 0.5, 1] })

    // AUDIO_ROOT からの相対パスを渡す（絶対パスや `..` を渡さない）
    const audioPath = analyzer.calls()[0]
    expect(audioPath).toBeDefined()
    expect(audioPath?.startsWith('/')).toBe(false)
    expect(audioPath).not.toContain('..')
    expect(audioPath).toContain('analysis-job-')
  })

  it('同じ analyzerVersion の解析が既にあれば解析も保存もしない（冪等）', async () => {
    const { deps, analyses, analyzer, track } = await harness({
      seed: (id) => [anAnalysis(id, DEFAULT_ANALYZER_VERSION)],
    })

    const outcome = await processAnalysisJob(deps, { musicTrackId: track.id })

    expect(outcome).toEqual({ state: 'skipped', reason: 'already_analyzed' })
    // 解析を呼ばず、行も増えない（既存の 1 件のまま）
    expect(analyzer.calls()).toHaveLength(0)
    expect(analyses.snapshot()).toHaveLength(1)
  })

  it('手動補正（manual）があるときは上書きしない', async () => {
    const { deps, analyses, analyzer, track } = await harness({
      seed: (id) => [anAnalysis(id, MANUAL_ANALYZER_VERSION, { bpm: 128 })],
    })

    const outcome = await processAnalysisJob(deps, { musicTrackId: track.id })

    expect(outcome).toEqual({ state: 'skipped', reason: 'manual_override' })
    expect(analyzer.calls()).toHaveLength(0)
    expect(analyses.snapshot()).toHaveLength(1)
    expect(analyses.snapshot()[0]?.bpm).toBe(128)
  })

  it('音源がストレージに無いとき失敗を握り潰さない', async () => {
    const { deps, analyses, analyzer, track } = await harness({ withAudio: false })

    const outcome = await processAnalysisJob(deps, { musicTrackId: track.id })

    expect(outcome.state).toBe('failed')
    expect(outcome).toMatchObject({ code: 'ObjectNotFoundError' })
    expect(analyzer.calls()).toHaveLength(0)
    expect(analyses.snapshot()).toHaveLength(0)
  })

  it('解析サービスが失敗したら failed を返し、解析行を作らない', async () => {
    const failing = fakeAnalyzer(analysisResult(), new Error('解析に失敗しました'))
    const { deps, analyses, track } = await harness({ analyzer: failing })

    const outcome = await processAnalysisJob(deps, { musicTrackId: track.id })

    expect(outcome.state).toBe('failed')
    expect(analyses.snapshot()).toHaveLength(0)
  })

  it('MusicTrack が見つからなければ throw する', async () => {
    const { deps } = await harness()
    await expect(processAnalysisJob(deps, { musicTrackId: newId(MusicTrackIdSchema) })).rejects.toThrow(
      /MusicTrack が見つかりません/,
    )
  })

  it('音源の MediaAsset が見つからなければ throw する', async () => {
    const { deps, track } = await harness({ withAsset: false })
    await expect(processAnalysisJob(deps, { musicTrackId: track.id })).rejects.toThrow(
      /MediaAsset が見つかりません/,
    )
  })

  it('別の解析器バージョンの解析しか無ければ解析する（共存できる）', async () => {
    const { deps, analyses, track } = await harness({
      seed: (id) => [anAnalysis(id, 'allin1-v1')],
    })

    const outcome = await processAnalysisJob(deps, { musicTrackId: track.id })

    expect(outcome.state).toBe('analyzed')
    // 既存の行は残したまま追記する（ADR-0009 の共存）
    expect(analyses.snapshot()).toHaveLength(2)
    expect(analyses.snapshot().map((a) => a.analyzerVersion)).toEqual([
      'allin1-v1',
      DEFAULT_ANALYZER_VERSION,
    ])
  })

  it('ジョブデータが不正なら zod が投げる', async () => {
    const { deps } = await harness()
    await expect(processAnalysisJob(deps, { musicTrackId: 'not-a-ulid' })).rejects.toThrow()
    await expect(processAnalysisJob(deps, {})).rejects.toThrow()
  })
})
