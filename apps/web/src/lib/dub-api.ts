import { DesignedVoiceGender, DubJob, type CharacterId, type DubJobId, type ShotId } from '@ixa/domain'
import { z } from 'zod'
import { WireVoice } from '@/lib/narration-api'
import type { Requester } from '@/lib/requester'

/**
 * 声の差し替え（ADR-0062）と、説明から声を作る（Voice Design）の口。
 * 押せるか（`blocker`）はサーバが domain の `dubBlocker` で決めたものをそのまま出す（規則を画面に書き写さない）。
 */

export const WireDubJob = DubJob.extend({
  queuedAt: z.coerce.date(),
  startedAt: z.coerce.date().nullable(),
  finishedAt: z.coerce.date().nullable(),
})
export type WireDubJob = z.infer<typeof WireDubJob>

export const WireShotDub = z.object({
  /** 差し替えられない理由（日本語）。差し替えられれば null。 */
  blocker: z.string().nullable(),
  latestJob: WireDubJob.nullable(),
})
export type WireShotDub = z.infer<typeof WireShotDub>

export const DesignVoiceBody = z
  .object({
    description: z.string().trim().min(1, '説明を入れてください').max(1000, '説明は 1000 字までにしてください'),
    gender: DesignedVoiceGender,
    displayName: z.string().trim().min(1, '名前を入れてください').max(40, '名前は 40 字までにしてください'),
  })
  .strict()
export type DesignVoiceBody = z.infer<typeof DesignVoiceBody>

export const WireDesignedVoice = z.object({ voice: WireVoice, sampleMediaAssetId: z.string().nullable() })
export type WireDesignedVoice = z.infer<typeof WireDesignedVoice>

export type DubApi = {
  getShotDub: (shotId: ShotId) => Promise<WireShotDub>
  startDub: (shotId: ShotId) => Promise<WireDubJob>
  getDubJob: (id: DubJobId) => Promise<WireDubJob>
  cancelDubJob: (id: DubJobId) => Promise<WireDubJob>
  /** 説明から声を作る。**作った時点で声として保存される**（Gemini の側にも残る。少し費用が掛かる）。 */
  designVoice: (characterId: CharacterId, body: DesignVoiceBody) => Promise<WireDesignedVoice>
}

const seg = encodeURIComponent

export const createDubApi = (requester: Requester): DubApi => ({
  getShotDub: (shotId) => requester.get(`/shots/${seg(shotId)}/dub`, WireShotDub),
  startDub: (shotId) => requester.post(`/shots/${seg(shotId)}/dub`, {}, WireDubJob),
  getDubJob: (id) => requester.get(`/dub-jobs/${seg(id)}`, WireDubJob),
  cancelDubJob: (id) => requester.post(`/dub-jobs/${seg(id)}/cancel`, undefined, WireDubJob),
  designVoice: (characterId, body) =>
    requester.post(`/characters/${seg(characterId)}/voices/design`, DesignVoiceBody.parse(body), WireDesignedVoice),
})
