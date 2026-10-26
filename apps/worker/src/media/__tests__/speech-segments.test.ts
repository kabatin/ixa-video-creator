import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMemoryStorage, type ObjectStorage } from '@ixa/storage'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { processMediaJob, type MediaOutcome } from '../processor.js'
import { inMemoryMediaAssets, readBytes, seedAsset, silentLogger, type InMemoryMediaAssets } from './doubles.js'
import { makeTestAudio, makeTestVideo } from './fixtures.js'

/**
 * 取り込みで、音のある動画の話している区間を測って probe に入れる（ADR-0061）。
 * セリフの字幕の時刻は、ここで測った区間を使う（api でも worker でも、同期のたびに ffmpeg を回さない）。
 */

const FFMPEG_TIMEOUT_MS = 120_000

let fixtureDir = ''
let videoBytes: Uint8Array
let audioBytes: Uint8Array

beforeAll(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), 'ixa-media-speech-'))
  videoBytes = await readBytes(await makeTestVideo(fixtureDir))
  audioBytes = await readBytes(await makeTestAudio(fixtureDir))
}, FFMPEG_TIMEOUT_MS)

afterAll(async () => {
  if (fixtureDir !== '') await rm(fixtureDir, { recursive: true, force: true })
})

describe('取り込みで話している区間を測る', () => {
  let repo: InMemoryMediaAssets
  let storage: ObjectStorage
  let workDir: string

  beforeEach(async () => {
    repo = inMemoryMediaAssets()
    storage = createMemoryStorage()
    workDir = await mkdtemp(join(tmpdir(), 'ixa-media-speech-work-'))
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  const processed = (outcome: MediaOutcome) => {
    expect(outcome.state).toBe('processed')
    return outcome as Extract<MediaOutcome, { state: 'processed' }>
  }

  it('音のある video は、鳴っている区間を probe に入れる（鳴りっぱなしの音は 1 区間）', async () => {
    const asset = await seedAsset(repo, storage, { kind: 'video', ext: 'mp4', mimeType: 'video/mp4', body: videoBytes })
    const outcome = processed(await processMediaJob({ mediaAssets: repo, storage, workDir, logger: silentLogger }, { mediaAssetId: asset.id }))
    expect(outcome.probe.speechSegments).toHaveLength(1)
    expect(outcome.probe.speechSegments?.[0]?.startSec).toBeCloseTo(0, 1)
    expect(outcome.probe.speechSegments?.[0]?.endSec).toBeCloseTo(1.5, 1)
    expect(repo.snapshot()[0]?.probe?.speechSegments).toEqual(outcome.probe.speechSegments)
  }, FFMPEG_TIMEOUT_MS)

  it('音だけの素材（曲・声）は測らない（鍵を持たない）', async () => {
    const asset = await seedAsset(repo, storage, { kind: 'audio', ext: 'm4a', mimeType: 'audio/mp4', body: audioBytes })
    const outcome = processed(await processMediaJob({ mediaAssets: repo, storage, workDir, logger: silentLogger }, { mediaAssetId: asset.id }))
    expect(outcome.probe).not.toHaveProperty('speechSegments')
  }, FFMPEG_TIMEOUT_MS)

  it('測れなくても取り込みは成功し、区間は「測っていない」（鍵なし）のまま', async () => {
    const asset = await seedAsset(repo, storage, { kind: 'video', ext: 'mp4', mimeType: 'video/mp4', body: videoBytes })
    const failing = () => Promise.reject(new Error('silencedetect が落ちた'))
    const outcome = processed(
      await processMediaJob({ mediaAssets: repo, storage, workDir, logger: silentLogger, detectSpeech: failing }, { mediaAssetId: asset.id }),
    )
    expect(outcome.probe.hasAudio).toBe(true)
    expect(outcome.probe).not.toHaveProperty('speechSegments')
  }, FFMPEG_TIMEOUT_MS)
})
