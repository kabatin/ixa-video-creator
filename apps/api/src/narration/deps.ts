import type {
  NarrationLineRepository,
  NarrationTakeRepository,
  ProjectAudioSettingsRepository,
  ProjectRepository,
  VoiceJobRepository,
  VoiceProfileRepository,
} from '@ixa/db'
import type { ProjectEventPublisher, ProjectId, VoiceJobId, VoiceToolId } from '@ixa/domain'
import type { VoiceAdapter } from '@ixa/provider-core'
import type { Logger } from 'pino'

/** ナレーションと声（ADR-0038）の API が使うもの。 */
export type NarrationDeps = {
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly voices: VoiceProfileRepository
  readonly lines: NarrationLineRepository
  readonly takes: NarrationTakeRepository
  readonly voiceJobs: VoiceJobRepository
  readonly audioSettings: ProjectAudioSettingsRepository
  /** 声の AI ごとの口（声の種類の一覧を出すため・使えるかを確かめるため）。口が無い AI は null。 */
  readonly voiceAdapter: (tool: VoiceToolId) => VoiceAdapter | null
  /** 声のジョブを worker の `voice` キューへ入れる。 */
  readonly voiceQueue: { readonly enqueue: (voiceJobId: VoiceJobId) => Promise<void> }
  /** 作品で使った額（動画の Take と声・文字起こし）。予算を確かめるのに使う。 */
  readonly spentByProject: (projectId: ProjectId) => Promise<number>
  /** 声 1 回の見積もり（domain の estimateSpeakCostUsd に設定を渡したもの）。 */
  readonly speakCostEstimate: (input: {
    readonly tool: VoiceToolId
    readonly model: string | null
    readonly readingChars: number
    readonly estimatedSec: number
  }) => number
  readonly events: ProjectEventPublisher
  readonly logger: Logger
}
