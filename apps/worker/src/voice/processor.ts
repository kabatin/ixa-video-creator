import type { VoiceJobError } from '@ixa/domain'
import { VoiceProviderError } from '@ixa/provider-core'
import { withTempDir } from '../media/temp-dir.js'
import { VoiceJobCancelled, VoiceJobFailure, type VoiceProcessorDeps } from './deps.js'
import { publishVoiceJobStatus } from './events.js'
import { VoiceJobData } from './job-data.js'
import { runPreview, runSpeak } from './speak.js'

export type { VoiceAudio, VoiceProcessorDeps } from './deps.js'

export type VoiceJobResult = { readonly state: 'succeeded' | 'failed' | 'skipped' | 'missing' }

/**
 * 声のジョブ（ADR-0038）。種類で分ける: 読む・試しに読む（`speak.ts`）、文字起こし・字の時刻（次の段）。
 * 失敗は理由をジョブに残して画面へ流す（握り潰さない）。止められたジョブからは理由を書かずに手を引く。
 */

const failureOf = (error: unknown): VoiceJobError => {
  if (error instanceof VoiceJobFailure) return error.failure
  if (error instanceof VoiceProviderError) return { code: error.code, message: error.message, retryable: error.retryable }
  return { code: 'unexpected', message: `声を作れませんでした: ${error instanceof Error ? error.message : String(error)}`, retryable: true }
}

export const processVoiceJob = async (deps: VoiceProcessorDeps, data: unknown): Promise<VoiceJobResult> => {
  const { voiceJobId } = VoiceJobData.parse(data)
  const job = await deps.voiceJobs.findById(voiceJobId)
  if (job === null) {
    deps.logger.warn({ voiceJobId }, '声のジョブが見つかりません')
    return { state: 'missing' }
  }
  // 終わったジョブと、人が止めたジョブは作らない。
  if (job.status !== 'queued' && job.status !== 'running') return { state: 'skipped' }

  try {
    switch (job.kind) {
      case 'speak':
        await withTempDir(deps.workDir, 'voice-', (dir) => runSpeak(deps, job, dir))
        break
      case 'preview':
        await withTempDir(deps.workDir, 'voice-', (dir) => runPreview(deps, job, dir))
        break
      case 'transcribe':
      case 'char_timing':
        throw new VoiceJobFailure({ code: 'not_implemented', message: 'この種類の声のジョブはまだ作れません。', retryable: false })
    }
    return { state: 'succeeded' }
  } catch (error) {
    if (error instanceof VoiceJobCancelled) {
      deps.logger.info({ voiceJobId, kind: job.kind, lineId: job.lineId }, '止められた声のジョブから手を引きました')
      return { state: 'skipped' }
    }
    const failure = failureOf(error)
    deps.logger.error({ voiceJobId, kind: job.kind, lineId: job.lineId, code: failure.code, err: error }, '声を作れませんでした')
    const failed = await deps.voiceJobs.markFailed(job.id, failure, null)
    await publishVoiceJobStatus(deps, failed)
    return { state: 'failed' }
  }
}
