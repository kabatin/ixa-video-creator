import type { AppConfig } from '@ixa/config'
import { createDubJobRepository, createVoiceProfileRepository, type DbClient } from '@ixa/db'
import { createGeminiVoiceDesigner } from '@ixa/provider-voice'
import { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { DUB_QUEUE_NAME, type DubRoutesDeps, type VoiceDesignPort } from './deps.js'

/**
 * 声を説明から作る口（ADR-0062）。**Gemini の声を使うと書いてあり（AUDIO_API_PROVIDERS）、鍵と鍵の名札があるときだけ**作る。
 * 名札が無いと、作った声がどの鍵のものか分からなくなる（別の鍵では読めない）ので作らせない。
 */
export const voiceDesignPort = (config: AppConfig): VoiceDesignPort | null => {
  const { apiKey, enabled, keyLabel } = {
    apiKey: config.voiceAi.geminiApiKey,
    enabled: config.voiceAi.apiProviders.includes('gemini_api'),
    keyLabel: config.voiceAi.geminiKeyLabel,
  }
  if (!enabled || apiKey === null || keyLabel === null) return null
  const designer = createGeminiVoiceDesigner({ apiKey, fetch: (url, init) => fetch(url, init) })
  return { designVoice: (request) => designer.designVoice(request), keyLabel }
}

/** 声の差し替えの口の配線（差し替えるのは worker の dub キュー）。閉じる口も返す。 */
export const createDubWiring = (input: {
  readonly config: AppConfig
  readonly db: DbClient
  readonly connection: Redis
}): { readonly deps: Pick<DubRoutesDeps, 'dubJobs' | 'dubQueue' | 'voices' | 'voiceDesign'>; readonly close: () => Promise<void> } => {
  const queue = new Queue(DUB_QUEUE_NAME, { connection: input.connection })
  return {
    deps: {
      dubJobs: createDubJobRepository(input.db),
      dubQueue: {
        enqueue: async (dubJobId) => {
          await queue.add('dub', { dubJobId })
        },
      },
      voices: createVoiceProfileRepository(input.db),
      voiceDesign: voiceDesignPort(input.config),
    },
    close: () => queue.close(),
  }
}
