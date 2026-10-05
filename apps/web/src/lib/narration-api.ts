import {
  CreateVoiceProfileInput,
  NarrationLine,
  NarrationTake,
  ProjectAudioSettings,
  UpdateNarrationLinePatch,
  UpdateVoiceProfilePatch,
  VoiceJob,
  VoiceJobKind,
  VoiceJobStatus,
  VoiceProfile,
  type MediaAssetId,
  type NarrationLineId,
  type NarrationTakeId,
  type ProjectId,
  type VoiceJobId,
  type VoiceProfileId,
  type VoiceToolId,
} from '@ixa/domain'
import { z } from 'zod'
import type { Requester } from '@/lib/requester'

/**
 * ナレーションと声（ADR-0038）の呼び出し口。声・原稿の行・声にする・録音を取り込む・作品の音の設定。
 * 声を作るのは時間が掛かる（ジョブ）。頼んだ口は受け付けたことしか返さないので、出来事（voice_job.status）で一覧を引き直す。
 */

export const WireVoice = VoiceProfile.extend({ createdAt: z.coerce.date(), updatedAt: z.coerce.date() })
export type WireVoice = z.infer<typeof WireVoice>

export const WireVoiceOptions = z.object({
  models: z.array(z.object({ id: z.string(), label: z.string() })),
  voices: z.array(z.object({ id: z.string(), label: z.string(), note: z.string().nullable() })),
})
export type WireVoiceOptions = z.infer<typeof WireVoiceOptions>

export const WireNarrationTake = NarrationTake.innerType().extend({ createdAt: z.coerce.date(), durationSec: z.number() })
export type WireNarrationTake = z.infer<typeof WireNarrationTake>

const WireLineJob = VoiceJob.pick({ id: true, kind: true, status: true, error: true, tool: true, costUsd: true }).extend({
  queuedAt: z.coerce.date(),
})

export const WireNarrationLine = NarrationLine.extend({
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  /** 読み（手で入れたもの、無ければ読み辞書から）。 */
  reading: z.string(),
  readingIsManual: z.boolean(),
  /** 話す長さの見積もり（秒）。 */
  estimatedSec: z.number(),
  /** 選んだ声の長さ（秒）。声が無ければ null。 */
  durationSec: z.number().nullable(),
  /** 原稿・読み・声を変えていて、作り直しが要る。 */
  stale: z.boolean(),
  takes: z.array(WireNarrationTake),
  /** いちばん新しい声のジョブ（作っている途中・失敗を出すため）。 */
  job: WireLineJob.nullable(),
})
export type WireNarrationLine = z.infer<typeof WireNarrationLine>

export const WireNarrationOverview = z.object({
  lines: z.array(WireNarrationLine),
  totalEstimatedSec: z.number(),
  /** ナレーションの終わり（置いた行の最後）。 */
  endSec: z.number(),
})
export type WireNarrationOverview = z.infer<typeof WireNarrationOverview>

export const WireVoiceJob = z.object({
  id: z.string(),
  kind: VoiceJobKind,
  status: VoiceJobStatus,
  lineId: z.string().nullable(),
  resultMediaAssetId: z.string().nullable(),
  costUsd: z.number().nullable(),
  error: z.string().nullable(),
  queuedAt: z.coerce.date(),
})
export type WireVoiceJob = z.infer<typeof WireVoiceJob>

export const WireAudioSettings = ProjectAudioSettings.innerType()
export type WireAudioSettings = z.infer<typeof WireAudioSettings>

const WireSpeakResult = z.object({ jobId: z.string().nullable(), reusedTakeId: z.string().nullable() })
export type WireSpeakResult = z.infer<typeof WireSpeakResult>

const WireBulkSpeakResult = z.object({
  jobIds: z.array(z.string()),
  reusedTakeIds: z.array(z.string()),
  skipped: z.object({ noVoice: z.number(), active: z.number(), upToDate: z.number() }),
})
export type WireBulkSpeakResult = z.infer<typeof WireBulkSpeakResult>

const WireAccepted = z.object({ jobId: z.string() })

/** 声を作る本文。作品は経路が持つ。 */
export const CreateVoiceBody = CreateVoiceProfileInput.omit({ projectId: true })
export type CreateVoiceBody = z.input<typeof CreateVoiceBody>

/** 行を直す本文。並び順は `reorderNarrationLines` で変える。 */
export const UpdateNarrationLineBody = UpdateNarrationLinePatch.omit({ order: true })
export type UpdateNarrationLineBody = z.input<typeof UpdateNarrationLineBody>

export type SaveAudioSettingsBody = Omit<WireAudioSettings, 'projectId'>

export type NarrationApi = {
  listVoices: (projectId: ProjectId) => Promise<WireVoice[]>
  createVoice: (projectId: ProjectId, body: CreateVoiceBody) => Promise<WireVoice>
  updateVoice: (id: VoiceProfileId, patch: UpdateVoiceProfilePatch) => Promise<WireVoice>
  /** 消すと、その声で話す行は「声が未定」に戻る。 */
  deleteVoice: (id: VoiceProfileId) => Promise<void>
  /** その AI で選べるモデルと声の種類。 */
  voiceOptions: (tool: VoiceToolId, language: string) => Promise<WireVoiceOptions>
  /** 好きな一文で試しに読む（ジョブ）。できた音は `getVoiceJob` の `resultMediaAssetId`。 */
  previewVoice: (id: VoiceProfileId, text: string) => Promise<{ jobId: string }>
  getVoiceJob: (id: VoiceJobId) => Promise<WireVoiceJob>
  getNarration: (projectId: ProjectId) => Promise<WireNarrationOverview>
  /** 原稿を貼り付ける（1 行 = 1 フレーズ）。前からある行の後ろに足す。 */
  pasteScript: (projectId: ProjectId, text: string, voiceProfileId: VoiceProfileId | null) => Promise<WireNarrationOverview>
  updateNarrationLine: (id: NarrationLineId, patch: UpdateNarrationLineBody) => Promise<WireNarrationOverview>
  deleteNarrationLine: (id: NarrationLineId) => Promise<void>
  reorderNarrationLines: (projectId: ProjectId, lineIds: readonly NarrationLineId[]) => Promise<WireNarrationOverview>
  /** 選んだ位置から、行を間を空けて順に置く。 */
  arrangeNarrationLines: (
    projectId: ProjectId,
    body: { readonly fromSec: number; readonly gapSec: number; readonly lineIds?: readonly NarrationLineId[] },
  ) => Promise<WireNarrationOverview>
  /** 1 行を声にする。同じ指定の声があれば作り直さず、それを選ぶ（`reusedTakeId`）。 */
  speakLine: (id: NarrationLineId) => Promise<WireSpeakResult>
  /** まとめて声にする（行を渡さなければ全部）。 */
  speakLines: (projectId: ProjectId, lineIds?: readonly NarrationLineId[]) => Promise<WireBulkSpeakResult>
  cancelVoiceJobs: (projectId: ProjectId, lineIds?: readonly NarrationLineId[]) => Promise<{ cancelledJobIds: string[] }>
  /** 録音を取り込む（文字起こしして行と Take にする）。 */
  importRecording: (
    projectId: ProjectId,
    body: { readonly mediaAssetId: MediaAssetId; readonly voiceProfileId: VoiceProfileId | null; readonly placeAtSec: number },
  ) => Promise<{ jobId: string }>
  /** 声の Take の字の時刻を取る（話している字の強調に使う）。 */
  requestCharTiming: (takeId: NarrationTakeId) => Promise<{ jobId: string }>
  getAudioSettings: (projectId: ProjectId) => Promise<WireAudioSettings>
  saveAudioSettings: (projectId: ProjectId, body: SaveAudioSettingsBody) => Promise<WireAudioSettings>
}

const enc = encodeURIComponent
const narrationPath = (projectId: ProjectId, suffix = ''): string => `/projects/${enc(projectId)}/narration${suffix}`

export const createNarrationApi = (requester: Requester): NarrationApi => ({
  listVoices: async (projectId) => requester.get(`/projects/${enc(projectId)}/voices`, z.array(WireVoice)),
  createVoice: async (projectId, body) =>
    requester.post(`/projects/${enc(projectId)}/voices`, CreateVoiceBody.parse(body), WireVoice),
  updateVoice: async (id, patch) => requester.patch(`/voices/${enc(id)}`, UpdateVoiceProfilePatch.parse(patch), WireVoice),
  deleteVoice: async (id) => requester.remove(`/voices/${enc(id)}`),
  voiceOptions: async (tool, language) =>
    requester.get(`/voices/options?${new URLSearchParams({ tool, language }).toString()}`, WireVoiceOptions),
  previewVoice: async (id, text) => requester.post(`/voices/${enc(id)}/preview`, { text }, WireAccepted),
  getVoiceJob: async (id) => requester.get(`/voice-jobs/${enc(id)}`, WireVoiceJob),
  getNarration: async (projectId) => requester.get(narrationPath(projectId), WireNarrationOverview),
  pasteScript: async (projectId, text, voiceProfileId) =>
    requester.post(narrationPath(projectId, '/script'), { text, voiceProfileId }, WireNarrationOverview),
  updateNarrationLine: async (id, patch) =>
    requester.patch(`/narration-lines/${enc(id)}`, UpdateNarrationLineBody.parse(patch), WireNarrationOverview),
  deleteNarrationLine: async (id) => requester.remove(`/narration-lines/${enc(id)}`),
  reorderNarrationLines: async (projectId, lineIds) =>
    requester.post(narrationPath(projectId, '/order'), { lineIds }, WireNarrationOverview),
  arrangeNarrationLines: async (projectId, body) =>
    requester.post(narrationPath(projectId, '/arrange'), body, WireNarrationOverview),
  speakLine: async (id) => requester.post(`/narration-lines/${enc(id)}/speak`, undefined, WireSpeakResult),
  speakLines: async (projectId, lineIds) =>
    requester.post(narrationPath(projectId, '/speak'), lineIds === undefined ? {} : { lineIds }, WireBulkSpeakResult),
  cancelVoiceJobs: async (projectId, lineIds) =>
    requester.post(
      `/projects/${enc(projectId)}/voice-jobs/cancel`,
      lineIds === undefined ? {} : { lineIds },
      z.object({ cancelledJobIds: z.array(z.string()) }),
    ),
  importRecording: async (projectId, body) => requester.post(narrationPath(projectId, '/recordings'), body, WireAccepted),
  requestCharTiming: async (takeId) => requester.post(`/narration-takes/${enc(takeId)}/char-timing`, undefined, WireAccepted),
  getAudioSettings: async (projectId) => requester.get(`/projects/${enc(projectId)}/audio-settings`, WireAudioSettings),
  saveAudioSettings: async (projectId, body) =>
    requester.put(`/projects/${enc(projectId)}/audio-settings`, body, WireAudioSettings),
})
