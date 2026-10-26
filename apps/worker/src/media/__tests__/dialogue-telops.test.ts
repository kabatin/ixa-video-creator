import {
  CharacterId,
  MediaAsset,
  MediaAssetId,
  ProjectId,
  WorkspaceId,
  dialogueTelopOf,
  newId,
  type MediaKind,
} from '@ixa/domain'
import {
  aShot,
  aTake,
  createInMemoryMediaAssetRepository,
  createInMemoryProjectClipLock,
  createInMemoryShotRepository,
  createInMemoryTakeRepository,
  createInMemoryTimelineClipRepository,
} from '@ixa/generation/testing'
import { describe, expect, it } from 'vitest'
import { allAfterIngested, syncDialogueTelopsAfterIngest } from '../dialogue-telops.js'
import { silentLogger } from './doubles.js'

/**
 * 取り込みが済んだら、セリフの字幕を作り直す（ADR-0061）。採用したあとで取り込みが終わった Take でも、
 * 測った話している区間に合わせる。
 */

const PROJECT = newId(ProjectId)

const setup = (kind: MediaKind = 'video') => {
  const asset = MediaAsset.parse({
    id: newId(MediaAssetId),
    workspaceId: newId(WorkspaceId),
    projectId: PROJECT,
    kind,
    storageKey: 'media/ws/a/original.mp4',
    mimeType: 'video/mp4',
    bytes: 1,
    checksumSha256: 'a'.repeat(64),
    probe: {
      durationSec: 4,
      width: 320,
      height: 240,
      fps: 24,
      hasAudio: true,
      codec: 'h264',
      speechSegments: [{ startSec: 0.5, endSec: 1.5 }, { startSec: 2, endSec: 3.5 }],
    },
    proxyKey: null,
    thumbnailKey: null,
    origin: { type: 'upload', uploadedBy: 'test' },
    createdAt: new Date(0),
  })
  const speakerId = newId(CharacterId)
  const base = aShot(PROJECT, {
    startSec: 10,
    durationSec: 4,
    dialogue: [
      { speakerId, text: 'ねえ', offscreen: false, translation: null },
      { speakerId, text: 'なに', offscreen: false, translation: null },
    ],
  })
  const take = aTake(base, 'a'.repeat(64), { mediaAssetId: asset.id })
  const timelineClips = createInMemoryTimelineClipRepository()
  const deps = {
    shots: createInMemoryShotRepository([{ ...base, selectedTakeId: take.id }]),
    takes: createInMemoryTakeRepository([take]),
    mediaAssets: createInMemoryMediaAssetRepository([asset]),
    lock: createInMemoryProjectClipLock(timelineClips),
    timelineClips,
    logger: silentLogger,
  }
  return { deps, asset }
}

describe('syncDialogueTelopsAfterIngest', () => {
  it('取り込んだ動画の作品の字幕を、話している区間に合わせて作り直す', async () => {
    const { deps, asset } = setup()
    await syncDialogueTelopsAfterIngest(deps)(asset)
    const telops = deps.timelineClips
      .snapshot()
      .filter((clip) => clip.content.type === 'text' && dialogueTelopOf(clip.content.params) !== null)
      .map((clip) => [clip.startSec, clip.durationSec])
      .sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0))
    expect(telops).toEqual([
      [10.5, 1],
      [12, 1.5],
    ])
  })

  it('動画でない素材（曲・声・画像）では作り直さない', async () => {
    const { deps, asset } = setup('audio')
    await syncDialogueTelopsAfterIngest(deps)(asset)
    expect(deps.timelineClips.snapshot()).toEqual([])
  })

  it('作り直しに失敗しても投げない（取り込みは済んでいる）', async () => {
    const { deps, asset } = setup()
    const broken = { ...deps, lock: (() => Promise.reject(new Error('DB が落ちた'))) as typeof deps.lock }
    await expect(syncDialogueTelopsAfterIngest(broken)(asset)).resolves.toBeUndefined()
  })

  it('知らせは順に全部呼ぶ', async () => {
    const { asset } = setup()
    const called: string[] = []
    await allAfterIngested(
      () => Promise.resolve(void called.push('字幕')),
      () => Promise.resolve(void called.push('レビュー')),
    )(asset)
    expect(called).toEqual(['字幕', 'レビュー'])
  })
})
