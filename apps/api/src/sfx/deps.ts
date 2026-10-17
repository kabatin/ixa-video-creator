import type { ProjectRepository, SfxJobRepository } from '@ixa/db'
import type { AiToolId, ProjectEventPublisher, ProjectId, SfxJobId, SfxSuggestionInput } from '@ixa/domain'
import type { Logger } from 'pino'
import type { SfxModelChoice } from './sfx-model.js'

/** 効果音を作るジョブのキューの名前（ADR-0052）。worker の `QUEUE_NAMES.sfx` と揃える。 */
export const SFX_QUEUE_NAME = 'sfx'

/** 効果音を作る（ADR-0052）API が使うもの。 */
export type SfxGenerationDeps = {
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly sfxJobs: SfxJobRepository
  /**
   * 効果音の AI で作れるか。`tool` を渡せばその AI、省略すれば「使う AI」で選んでいるもの（使うたびに読む）。
   */
  readonly sfxModel: (tool?: AiToolId) => Promise<SfxModelChoice>
  /** 効果音のジョブを worker の `sfx` キューへ入れる。 */
  readonly sfxQueue: { readonly enqueue: (sfxJobId: SfxJobId) => Promise<void> }
  readonly events: ProjectEventPublisher
  readonly logger: Logger
}

/** 案を出すための、タイムラインのエフェクトとトランジション（書き出しと同じ組み立て）。作品が無ければ null。 */
export type SfxSuggestionSource = (projectId: ProjectId) => Promise<SfxSuggestionInput | null>
