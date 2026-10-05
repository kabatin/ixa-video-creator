import type { VoiceJob } from '@ixa/domain'
import { syncNarrationTelops } from '@ixa/generation'
import type { VoiceProcessorDeps } from './deps.js'

/**
 * 声ができたら、ナレーションのテロップを作り直す（ADR-0038）。出来事を流す前に呼ぶ（画面が読み直したときに揃っている）。
 * **上乗せ。** 作れなくても声の Take は取り消さない（理由はログに残す。行を直すか、もう一度声にすると作り直す）。
 */
export const syncTelopsAfterVoice = async (deps: VoiceProcessorDeps, job: VoiceJob): Promise<void> => {
  try {
    await syncNarrationTelops(deps, job.projectId)
  } catch (error) {
    deps.logger.error(
      { voiceJobId: job.id, projectId: job.projectId, err: error },
      'ナレーションのテロップを作り直せませんでした。行を動かすか、もう一度声にすると作り直します',
    )
  }
}
