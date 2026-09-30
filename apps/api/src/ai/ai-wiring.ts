import type { AppConfig } from '@ixa/config'
import { createAiSettingsRepository, type DbClient } from '@ixa/db'
import { aiDefaultsFromEnv, resolveAiSettings, type AiSettings } from '@ixa/domain'
import { execFileCliRunner } from '@ixa/provider-core'
import { checkVpipeHealth } from '@ixa/provider-video'
import type { AiRoutesDeps } from '../routes/ai.js'
import { detectAiTools } from './detect-ai-tools.js'

export type AiWiring = AiRoutesDeps & {
  /** いま使う AI。**使うたびに読む**（画面で選び直したら次の 1 回から効く）。 */
  readonly current: () => Promise<AiSettings>
}

/** 使う AI（ADR-0032）の配線。見つけ方・保存先・初期値をここで 1 度だけ決める。 */
export const createAiWiring = (config: AppConfig, db: DbClient): AiWiring => {
  const repository = createAiSettingsRepository(db)
  const defaults = aiDefaultsFromEnv({
    storyboardDrafter: config.storyboardDrafter,
    imageProvider: config.imageProvider,
    videoProvider: config.providers.videoProvider,
    localVideoGenerator: config.providers.localVideoGenerator,
  })
  return {
    settings: repository,
    defaults,
    detect: () =>
      detectAiTools({
        runCli: execFileCliRunner,
        fal: {
          keyConfigured: config.providers.falApiKey !== null,
          enabled: config.providers.falApiKey !== null && config.providers.videoProvider === 'fal',
        },
        checkLocalServer: () =>
          checkVpipeHealth({ baseUrl: config.providers.vpipeApiUrl, token: config.providers.vpipeApiToken }),
      }),
    current: async () => resolveAiSettings(await repository.get(), defaults).settings,
  }
}
