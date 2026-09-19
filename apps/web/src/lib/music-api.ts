import {
  UpdateMusicTrackPatch,
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

/**
 * 波形の上で決めた区切りから作った結果。
 *
 * **一括作成と違い `requestedCount` と `section` を持たない。** 時間を直接指定する経路には
 * 「要求したが作れなかった数」が無く、支えられない入力は減らさず 422 で弾かれる。
 * 意味の無い数を同じ名前で返すと、減ることがあると読み違える。
 */
export const WireCreateCutsResult = z.object({
  shots: z.array(WireShot),
  createdCount: z.number(),
  /** 現状この経路では常に空。「警告が無い」であって「見ていない」ではない。 */
  warnings: z.array(z.string()),
})
export type WireCreateCutsResult = z.infer<typeof WireCreateCutsResult>

export type CreateCutsBody = {
  /** 区切りの時刻（秒・float）。昇順・重複なし。N 個で N-1 カットできる。 */
  readonly boundariesSec: readonly number[]
  readonly sequenceId: SequenceId | null
  /** `CUT-01` の `CUT` の部分。省略すると API 側の既定になる。 */
  readonly codePrefix?: string
}

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
  /** 区切りの列から Shot を作る。セクション解析を介さない経路。 */
  createCuts: (projectId: ProjectId, body: CreateCutsBody) => Promise<WireCreateCutsResult>
  /** 題名・オフセット・音量を直す（PHASE 8 / ADR-0022）。マスターは `setMasterTrack`。 */
  updateMusicTrack: (id: MusicTrackId, patch: UpdateMusicTrackPatch) => Promise<MusicTrack>
  /** この曲をマスターにする。**降格した曲も含めて Project の全曲**を返す。 */
  setMasterTrack: (id: MusicTrackId) => Promise<MusicTrack[]>
  /** ソフトデリート。マスターを消したら残りの最古がマスターになる（サーバが決める）。 */
  deleteMusicTrack: (id: MusicTrackId) => Promise<void>
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

  createCuts: async (projectId, body) =>
    requester.post(
      `/projects/${encodeURIComponent(projectId)}/storyboard/cuts`,
      body,
      WireCreateCutsResult,
    ),

  updateMusicTrack: async (id, patch) =>
    requester.patch(trackPath(id), UpdateMusicTrackPatch.parse(patch), WireMusicTrack),

  setMasterTrack: async (id) =>
    requester.post(trackPath(id, '/set-master'), undefined, WireMusicTrackList),

  deleteMusicTrack: async (id) => requester.remove(trackPath(id)),
})
