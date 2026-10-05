import type {
  MediaAssetRepository,
  NarrationLineRepository,
  NarrationTakeRepository,
  ProjectAudioSettingsRepository,
  ProjectRepository,
  VoiceJobRepository,
} from '@ixa/db'
import type { MediaAssetId, ProjectEventPublisher, VoiceJobError, VoiceToolId } from '@ixa/domain'
import type { LoudnessMeasurement } from '@ixa/media'
import type { TranscribeToolId, Transcriber, VoiceAdapter } from '@ixa/provider-core'
import type { ObjectStorage } from '@ixa/storage'
import type { Logger } from 'pino'

/** 音を整える・測る口。テストで ffmpeg を使わないための差し込み口。 */
export type VoiceAudio = {
  /** 大きさを整えて書き、整えた後の大きさを返す。録音は軽いノイズ除去も掛ける。 */
  readonly normalize: (input: string, output: string, options: { readonly denoise: boolean }) => Promise<LoudnessMeasurement>
  readonly durationSec: (path: string) => Promise<number>
  /** 波形の点（0〜1）。`rawPath` は作業用のファイル。 */
  readonly peaks: (path: string, rawPath: string, points: number) => Promise<readonly number[]>
}

export type VoiceProcessorDeps = {
  readonly voiceJobs: VoiceJobRepository
  readonly lines: NarrationLineRepository
  readonly takes: NarrationTakeRepository
  readonly audioSettings: ProjectAudioSettingsRepository
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly mediaAssets: Pick<MediaAssetRepository, 'findById' | 'findByChecksum' | 'create'>
  readonly storage: ObjectStorage
  /** 声の AI ごとの口（`@ixa/provider-voice` の表）。口が無い AI は null。 */
  readonly voiceAdapter: (tool: VoiceToolId) => VoiceAdapter | null
  readonly transcriber: (tool: TranscribeToolId) => Transcriber | null
  readonly audio: VoiceAudio
  readonly mediaQueue: { readonly enqueue: (mediaAssetId: MediaAssetId) => Promise<void> }
  readonly events: ProjectEventPublisher
  readonly workDir: string
  readonly logger: Logger
}

/** 理由を付けて失敗にする。画面にそのまま出せる文を持つ。 */
export class VoiceJobFailure extends Error {
  readonly failure: VoiceJobError

  constructor(failure: VoiceJobError) {
    super(failure.message)
    this.name = 'VoiceJobFailure'
    this.failure = failure
  }
}

/** 人が止めた。失敗ではないので理由を書かずに手を引く。 */
export class VoiceJobCancelled extends Error {
  constructor(voiceJobId: string) {
    super(`声のジョブ ${voiceJobId} は止められました`)
    this.name = 'VoiceJobCancelled'
  }
}
