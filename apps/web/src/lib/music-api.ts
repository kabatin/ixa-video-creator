import {
  CreateMusicTrackInput,
  MusicSection,
  MusicTrack,
  type MusicTrackId,
  type ProjectId,
  type SequenceId,
} from '@ixa/domain'
import { z } from 'zod'
import { WireShot } from '@/lib/api-schemas'
import type { Requester } from '@/lib/requester'

/**
 * 楽曲・音楽解析・ストーリーボードの呼び出し口（P3-3 / P3-4）。
 *
 * 解析は非同期で走る。`requestAnalysis` は受け付けられたことしか返さないので、
 * 結果は `getAnalysis` を引き直して確かめる。
 */

export const WireMusicTrack = MusicTrack
export const WireMusicTrackList = z.array(WireMusicTrack)

/**
 * 楽曲を登録するときの本文。
 * `projectId` は経路が持つので本文には載せない（API 側と同じ形。正を 2 つにしない）。
 */
export const CreateMusicTrackBody = CreateMusicTrackInput.omit({ projectId: true })
export type CreateMusicTrackBody = z.input<typeof CreateMusicTrackBody>

/**
 * 解析結果の受け取り形。`waveformPeaksKey` は API が返さず、
 * 代わりに都度発行された署名付き URL が入る。
 */
export const WireMusicAnalysis = z.object({
  musicTrackId: z.string(),
  analyzerVersion: z.string(),
  durationSec: z.number(),
  bpm: z.number(),
  bpmConfidence: z.number(),
  beats: z.array(z.number()),
  downbeats: z.array(z.number()),
  sections: z.array(MusicSection),
  onsets: z.array(z.number()),
  drops: z.array(z.number()),
  waveformPeaksUrl: z.string(),
  createdAt: z.string(),
})
export type WireMusicAnalysis = z.infer<typeof WireMusicAnalysis>

export const WireAnalysisAccepted = z.object({
  musicTrackId: z.string(),
  queued: z.boolean(),
})
export type WireAnalysisAccepted = z.infer<typeof WireAnalysisAccepted>

export const WireAllocateResult = z.object({
  shots: z.array(WireShot),
  requestedCount: z.number(),
  createdCount: z.number(),
  section: z.object({ index: z.number(), label: z.string() }),
  /** グリッドがカット数を支えられず減らしたときの理由（ADR-0017）。必ず画面に出す。 */
  warnings: z.array(z.string()),
})
export type WireAllocateResult = z.infer<typeof WireAllocateResult>

export type AllocateShotsBody = {
  readonly musicTrackId: MusicTrackId
  readonly sectionIndex: number
  readonly requestedCount: number
  readonly subdivision: 1 | 0.5 | 0.25
  readonly sequenceId: SequenceId | null
}

export type MusicApi = {
  listMusicTracks: (projectId: ProjectId) => Promise<MusicTrack[]>
  /** 音源（MediaAsset）を楽曲として登録する。音声以外は API が 422 で弾く。 */
  createMusicTrack: (projectId: ProjectId, body: CreateMusicTrackBody) => Promise<MusicTrack>
  /** 未解析なら null。解析前でも画面を出せるようにするため 404 を畳む。 */
  getAnalysis: (musicTrackId: MusicTrackId) => Promise<WireMusicAnalysis | null>
  requestAnalysis: (musicTrackId: MusicTrackId) => Promise<WireAnalysisAccepted>
  allocateShots: (projectId: ProjectId, body: AllocateShotsBody) => Promise<WireAllocateResult>
}

const trackPath = (id: MusicTrackId, suffix = ''): string =>
  `/music-tracks/${encodeURIComponent(id)}${suffix}`

export const createMusicApi = (requester: Requester): MusicApi => ({
  listMusicTracks: async (projectId) =>
    requester.get(`/projects/${encodeURIComponent(projectId)}/music-tracks`, WireMusicTrackList),

  createMusicTrack: async (projectId, body) =>
    requester.post(
      `/projects/${encodeURIComponent(projectId)}/music-tracks`,
      CreateMusicTrackBody.parse(body),
      WireMusicTrack,
    ),

  getAnalysis: async (musicTrackId) =>
    requester.getOrNull(trackPath(musicTrackId, '/analysis'), WireMusicAnalysis),

  requestAnalysis: async (musicTrackId) =>
    requester.post(trackPath(musicTrackId, '/analysis'), undefined, WireAnalysisAccepted),

  allocateShots: async (projectId, body) =>
    requester.post(
      `/projects/${encodeURIComponent(projectId)}/storyboard/shots`,
      body,
      WireAllocateResult,
    ),
})
