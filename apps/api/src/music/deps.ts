import type { MusicJobRepository, ProjectRepository } from '@ixa/db'
import type { AiToolId, MusicJobId, ProjectEventPublisher } from '@ixa/domain'
import type { Logger } from 'pino'
import type { MusicModelChoice } from './music-model.js'

/** 曲を作るジョブのキューの名前（ADR-0048）。worker の `QUEUE_NAMES.music` と揃える。 */
export const MUSIC_QUEUE_NAME = 'music'

/** 曲を作る（ADR-0048）API が使うもの。 */
export type MusicGenerationDeps = {
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly musicJobs: MusicJobRepository
  /**
   * 曲の AI で作れるか。`tool` を渡せばその AI（歌ありを回す先）、省略すれば選んでいるもの（「使う AI」。使うたびに読む）。
   */
  readonly musicModel: (tool?: AiToolId) => Promise<MusicModelChoice>
  /** 曲のジョブを worker の `music` キューへ入れる。 */
  readonly musicQueue: { readonly enqueue: (musicJobId: MusicJobId) => Promise<void> }
  readonly events: ProjectEventPublisher
  readonly logger: Logger
}
