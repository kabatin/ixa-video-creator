import { z } from 'zod'
import { MediaAssetId, NarrationLineId, NarrationTakeId, ProjectId, VoiceJobId, VoiceProfileId } from '../common/ids.js'
import { VoiceSpec } from './voice-spec.js'

/**
 * 声のジョブ（ADR-0038）。worker のキュー `voice` で 1 つずつ動かす（AI の上限に配慮）。
 *
 * - `speak`: 行を声にする → 行の Take ができる
 * - `preview`: 声を試しに読む → 音だけ残す（Take にしない）
 * - `transcribe`: 録音を文字起こしする → 行と Take ができる
 * - `char_timing`: Take の字の時刻を取る（Gemini・Mac の声は時刻を返さないため。強調する字幕に使う）
 *
 * 画像のジョブと違い、**費用を保存する**（頼む前に予算も確かめる）。
 */

export const VoiceJobKind = z.enum(['speak', 'preview', 'transcribe', 'char_timing'])
export type VoiceJobKind = z.infer<typeof VoiceJobKind>

export const VoiceJobStatus = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled'])
export type VoiceJobStatus = z.infer<typeof VoiceJobStatus>

export const VoiceJobError = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
})
export type VoiceJobError = z.infer<typeof VoiceJobError>

export const VoiceJob = z.object({
  id: VoiceJobId,
  projectId: ProjectId,
  kind: VoiceJobKind,
  lineId: NarrationLineId.nullable(),
  /** 字の時刻を取る Take。 */
  takeId: NarrationTakeId.nullable(),
  voiceProfileId: VoiceProfileId.nullable(),
  /** 文字起こし・字の時刻で聞く音。 */
  inputMediaAssetId: MediaAssetId.nullable(),
  /** できた音（試しに読む）。 */
  resultMediaAssetId: MediaAssetId.nullable(),
  /** 使う AI（声または文字起こしの AI）。 */
  tool: z.string().min(1),
  model: z.string().nullable(),
  spec: VoiceSpec.nullable(),
  status: VoiceJobStatus,
  /** 実際に掛かった額。終わるまで null。 */
  costUsd: z.number().nonnegative().nullable(),
  error: VoiceJobError.nullable(),
  queuedAt: z.date(),
  startedAt: z.date().nullable(),
  finishedAt: z.date().nullable(),
})
export type VoiceJob = z.infer<typeof VoiceJob>

/** 種類ごとに要るものが揃っているか。揃っていれば null。 */
export const voiceJobViolation = (job: VoiceJob): string | null => {
  switch (job.kind) {
    case 'speak':
      if (job.lineId === null) return '声にする行がありません'
      if (job.voiceProfileId === null) return '声がありません'
      return job.spec === null ? '声の指定がありません' : null
    case 'preview':
      if (job.voiceProfileId === null) return '声がありません'
      return job.spec === null ? '声の指定がありません' : null
    case 'transcribe':
      return job.inputMediaAssetId === null ? '文字起こしする音がありません' : null
    case 'char_timing':
      if (job.takeId === null) return '字の時刻を取る Take がありません'
      return job.inputMediaAssetId === null ? '字の時刻を取る音がありません' : null
  }
}
