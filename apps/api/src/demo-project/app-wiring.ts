import type { AppDeps } from '../app.js'
import type { ProjectDuplicationDeps } from '../project-duplication/deps.js'
import { noDemoBundle } from './bundle-source.js'
import { createDemoInstaller, type DemoInstaller } from './installer.js'

/**
 * アプリの依存から見本を入れる口を組む（`createApp` が 1 回だけ呼ぶ。ADR-0067）。
 * 入れている途中の表は、ここで作る口が 1 つだけ持つ。出どころが無ければ「まだ用意されていません」。
 * 書き手は作品の複製と同じ口（`duplicationDepsFromApp`）。
 */
export const demoInstallerFromApp = (deps: AppDeps, writers: ProjectDuplicationDeps): DemoInstaller =>
  createDemoInstaller({
    bundle: deps.demoBundle ?? noDemoBundle,
    projects: deps.projects,
    mediaAssets: deps.mediaAssets,
    ...(deps.mediaIngest === undefined ? {} : { mediaIngest: deps.mediaIngest }),
    storage: deps.storage,
    writers,
    logger: deps.logger,
  })
