import type {
  NarrationLineRepository,
  NarrationTakeRepository,
  ProjectAudioSettingsRepository,
  ProjectRepository,
  VoiceJobRepository,
  VoiceProfileRepository,
} from '@ixa/db'
import type { VoiceToolId } from '@ixa/domain'
import type { VoiceAdapter } from '@ixa/provider-core'

/** ナレーションと声（ADR-0038）の API が使うもの。 */
export type NarrationDeps = {
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly voices: VoiceProfileRepository
  readonly lines: NarrationLineRepository
  readonly takes: NarrationTakeRepository
  readonly voiceJobs: VoiceJobRepository
  readonly audioSettings: ProjectAudioSettingsRepository
  /** 声の AI ごとの口（声の種類の一覧を出すため）。口が無い AI は null。 */
  readonly voiceAdapter: (tool: VoiceToolId) => VoiceAdapter | null
}
