import type {
  CharacterRepository,
  EditBatchRepository,
  MediaAssetRepository,
  NarrationLineRepository,
  NarrationTakeRepository,
  ProjectAudioSettingsRepository,
  ProjectRepository,
  TextStyleRepository,
  TimelineClipRepository,
  VoiceJobRepository,
  VoiceProfileRepository,
} from '@ixa/db'
import type { AiToolId, ProjectEventPublisher, ProjectId, VoiceJobId, VoiceToolId } from '@ixa/domain'
import type { TranscribeToolId, Transcriber, VoiceAdapter } from '@ixa/provider-core'
import type { Logger } from 'pino'

/** ナレーションと声（ADR-0038）の API が使うもの。 */
export type NarrationDeps = {
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly voices: VoiceProfileRepository
  readonly lines: NarrationLineRepository
  readonly takes: NarrationTakeRepository
  readonly voiceJobs: VoiceJobRepository
  readonly audioSettings: ProjectAudioSettingsRepository
  /** ナレーションのテロップを作り直すため（行の見た目を選ぶ・差し替える）。 */
  readonly textStyles: Pick<TextStyleRepository, 'findByProject'>
  readonly timelineClips: Pick<TimelineClipRepository, 'findByProject' | 'replace'>
  /** 声をキャラクターの声にするとき、その作品のキャラクターかを確かめる。 */
  readonly characters: Pick<CharacterRepository, 'findById'>
  /** まとめて並べた記録（戻せるようにする）。記録を作れない環境では省く。 */
  readonly editBatches?: Pick<EditBatchRepository, 'create'>
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
  /** 録音（取り込む音）を確かめる。 */
  readonly mediaAssets: Pick<MediaAssetRepository, 'findById'>
  /** いま選んでいる文字起こしの AI（「使う AI」。使うたびに読む）。 */
  readonly currentTranscribeTool: () => Promise<AiToolId>
  /** 文字起こしの AI ごとの口（使えるかを確かめるため）。口が無い AI は null。 */
  readonly transcriber: (tool: TranscribeToolId) => Transcriber | null
  /** 文字起こし 1 回の見積もり（domain の estimateTranscribeCostUsd）。 */
  readonly transcribeCostEstimate: (input: { readonly tool: TranscribeToolId; readonly durationSec: number }) => number
  readonly events: ProjectEventPublisher
  readonly logger: Logger
}
