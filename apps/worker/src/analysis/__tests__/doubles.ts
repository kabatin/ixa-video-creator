import type { MusicAnalysisRepository } from '@ixa/db'
import {
  MediaAsset as MediaAssetSchema,
  MediaAssetId as MediaAssetIdSchema,
  MusicAnalysis as MusicAnalysisSchema,
  MusicAnalysisId as MusicAnalysisIdSchema,
  MusicTrack as MusicTrackSchema,
  MusicTrackId as MusicTrackIdSchema,
  ProjectId as ProjectIdSchema,
  WorkspaceId as WorkspaceIdSchema,
  newId,
  type MediaAsset,
  type MediaAssetId,
  type MusicAnalysis,
  type MusicTrack,
  type MusicTrackId,
} from '@ixa/domain'
import type { MusicAnalysisResult, MusicAnalyzer } from '@ixa/music'
import { mediaKey, type ObjectStorage } from '@ixa/storage'
import pino from 'pino'
import type { MusicTrackLookup } from '../processor.js'

/**
 * analysis プロセッサのテストダブル。
 * 実 DB / 実ストレージ / 実 `apps/audio` には接続しない。
 */

export const silentLogger = pino({ level: 'silent' })

export const CREATED_AT = new Date('2026-01-01T00:00:00.000Z')

/* --- MusicTrack --- */

export type InMemoryMusicTracks = MusicTrackLookup & {
  readonly add: (track: MusicTrack) => void
}

export const inMemoryMusicTracks = (): InMemoryMusicTracks => {
  let store: readonly MusicTrack[] = []
  return {
    add: (track) => {
      store = [...store, track]
    },
    findById: (id) => Promise.resolve(store.find((t) => t.id === id) ?? null),
  }
}

export const aMusicTrack = (overrides: Partial<MusicTrack> = {}): MusicTrack =>
  MusicTrackSchema.parse({
    id: newId(MusicTrackIdSchema),
    projectId: newId(ProjectIdSchema),
    mediaAssetId: newId(MediaAssetIdSchema),
    title: 'iXA CUP MUSIC VIDEO',
    isMaster: true,
    offsetSec: 0,
    volume: 1,
    ...overrides,
  })

/* --- MusicAnalysis --- */

export type InMemoryMusicAnalyses = MusicAnalysisRepository & {
  readonly snapshot: () => readonly MusicAnalysis[]
}

/** 追記のみ。UPDATE の口を持たないことで「上書きされない」ことを構造で担保する。 */
export const inMemoryMusicAnalyses = (
  seed: readonly MusicAnalysis[] = [],
): InMemoryMusicAnalyses => {
  let store: readonly MusicAnalysis[] = seed

  const latest = (candidates: readonly MusicAnalysis[]): MusicAnalysis | null =>
    candidates.length === 0 ? null : (candidates[candidates.length - 1] as MusicAnalysis)

  return {
    snapshot: () => store,

    findByTrack: (musicTrackId) =>
      Promise.resolve(latest(store.filter((a) => a.musicTrackId === musicTrackId))),

    findByTrackAndVersion: (musicTrackId, analyzerVersion) =>
      Promise.resolve(
        latest(
          store.filter(
            (a) => a.musicTrackId === musicTrackId && a.analyzerVersion === analyzerVersion,
          ),
        ),
      ),

    create: (input) => {
      const created = MusicAnalysisSchema.parse({
        ...input,
        id: newId(MusicAnalysisIdSchema),
        createdAt: CREATED_AT,
      })
      store = [...store, created]
      return Promise.resolve(created)
    },
  }
}

export const anAnalysis = (
  musicTrackId: MusicTrackId,
  analyzerVersion: string,
  overrides: Partial<MusicAnalysis> = {},
): MusicAnalysis =>
  MusicAnalysisSchema.parse({
    id: newId(MusicAnalysisIdSchema),
    musicTrackId,
    analyzerVersion,
    durationSec: 116,
    bpm: 120,
    bpmConfidence: 0.9,
    beats: [0, 0.5],
    downbeats: [0],
    sections: [{ start: 0, end: 116, label: 'intro', energy: 0.3 }],
    energyCurve: { hopSec: 0.05, values: [0, 1] },
    onsets: [0],
    drops: [],
    waveformPeaksKey: 'music/existing/peaks.json',
    createdAt: CREATED_AT,
    ...overrides,
  })

/* --- MediaAsset --- */

export type InMemoryMediaAssets = {
  findById(id: MediaAssetId): Promise<MediaAsset | null>
  readonly add: (asset: MediaAsset) => void
}

export const inMemoryMediaAssets = (): InMemoryMediaAssets => {
  let store: readonly MediaAsset[] = []
  return {
    add: (asset) => {
      store = [...store, asset]
    },
    findById: (id) => Promise.resolve(store.find((a) => a.id === id) ?? null),
  }
}

export const anAudioAsset = (id: MediaAssetId, ext = 'wav'): MediaAsset =>
  MediaAssetSchema.parse({
    id,
    workspaceId: newId(WorkspaceIdSchema),
    projectId: newId(ProjectIdSchema),
    kind: 'audio',
    storageKey: mediaKey(newId(WorkspaceIdSchema), id, ext),
    mimeType: 'audio/wav',
    bytes: 4,
    checksumSha256: 'a'.repeat(64),
    probe: null,
    proxyKey: null,
    thumbnailKey: null,
    posterKeys: [],
    lastFrameAssetId: null,
    origin: { type: 'upload', uploadedBy: 'test' },
    tags: [],
    createdAt: CREATED_AT,
  })

/* --- MusicAnalyzer --- */

export type FakeAnalyzer = MusicAnalyzer & {
  /** analyze に渡されたパス。呼ばれていなければ空配列。 */
  readonly calls: () => readonly string[]
}

export const analysisResult = (
  overrides: Partial<MusicAnalysisResult> = {},
): MusicAnalysisResult => ({
  analyzerVersion: 'librosa-v2',
  bpm: 119.9984,
  bpmConfidence: 0.93,
  beats: [0, 0.5, 1],
  downbeats: [0, 2],
  sections: [{ start: 0, end: 116, label: 'chorus', energy: 0.8 }],
  energyCurve: { hopSec: 0.05, values: [0, 0.5, 1] },
  onsets: [0.01],
  drops: [32.5],
  durationSec: 116,
  peaks: [0, 0.5, 1],
  waveform: null,
  ...overrides,
})

/** `analyze` の結果を固定で返す解析器。`fail` を渡すとその例外を投げる。 */
export const fakeAnalyzer = (
  result: MusicAnalysisResult = analysisResult(),
  fail?: Error,
): FakeAnalyzer => {
  let calls: readonly string[] = []
  return {
    calls: () => calls,
    health: () => Promise.resolve(true),
    analyze: (audioPath) => {
      calls = [...calls, audioPath]
      return fail === undefined ? Promise.resolve(result) : Promise.reject(fail)
    },
  }
}

/** 音源の実体をストレージへ置く。置かなければ「原本が取れない」失敗を再現できる。 */
export const putAudio = async (storage: ObjectStorage, asset: MediaAsset): Promise<void> => {
  await storage.put(asset.storageKey, new Uint8Array([1, 2, 3, 4]), {
    contentType: asset.mimeType,
  })
}
