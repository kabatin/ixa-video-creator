import { MediaAssetId, SfxJobStatus, type ProjectId, type SfxCueInput } from '@ixa/domain'
import { z } from 'zod'
import type { Requester } from '@/lib/requester'

/**
 * 効果音を作るジョブ（ADR-0052）の口。素材ツリーの「効果音」で、作った音に説明（きっかけの文）を添えるのに使う。
 * 頼むのは「効果音を作る」窓（ADR-0054）。使う AI は「使う AI」の効果音で、本数は既定 1。
 */

const WireSfxCue = z.object({
  startSec: z.number(),
  durationSec: z.number(),
  prompt: z.string(),
  volume: z.number(),
})

/** 画面で使う欄だけを読む（ほかの欄は捨てる）。 */
export const WireSfxJob = z.object({
  id: z.string(),
  status: SfxJobStatus,
  cue: WireSfxCue,
  /** 素材の ID の形でなければ読み込みごと失敗させる（黙って行を落とさない）。 */
  mediaAssetIds: z.array(MediaAssetId),
  timelineClipId: z.string().nullable(),
})
export type WireSfxJob = z.infer<typeof WireSfxJob>

const WireSfxJobList = z.array(WireSfxJob)

export type SfxJobApi = {
  /** 作品で最近頼んだジョブ（新しい順・最大 50 件）。 */
  listSfxJobs: (projectId: ProjectId) => Promise<WireSfxJob[]>
  /** きっかけごとにジョブを作る。1 本目が効果音の段に置かれる。 */
  generateSfx: (projectId: ProjectId, cues: readonly SfxCueInput[]) => Promise<readonly string[]>
}

const WireGenerated = z.object({ jobIds: z.array(z.string()) })

export const createSfxJobApi = (requester: Requester): SfxJobApi => ({
  listSfxJobs: async (projectId) =>
    requester.get(`/projects/${encodeURIComponent(projectId)}/sfx-jobs`, WireSfxJobList),
  generateSfx: async (projectId, cues) =>
    (await requester.post(`/projects/${encodeURIComponent(projectId)}/sfx/generate`, { cues, count: 1 }, WireGenerated))
      .jobIds,
})
