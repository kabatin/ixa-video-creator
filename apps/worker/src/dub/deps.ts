import type {
  CharacterRepository,
  DubJobRepository,
  MediaAssetRepository,
  ProjectClipLock,
  ProjectRepository,
  ShotRepository,
  TakeRepository,
  TtsClipRepository,
  VoiceProfileRepository,
} from '@ixa/db'
import type { DubJobError, DubLineSpanSuggestion, MediaAssetId, ProjectEventPublisher, VoiceToolId } from '@ixa/domain'
import type { VoiceAdapter } from '@ixa/provider-core'
import type { ObjectStorage } from '@ixa/storage'
import type { Logger } from 'pino'
import type { RecordTakeDeps } from '../generation/complete.js'

/** 声の差し替え（ADR-0062 段 5b）の worker が使うもの。 */
export type DubProcessorDeps = RecordTakeDeps & {
  readonly dubJobs: DubJobRepository
  readonly ttsClips: TtsClipRepository
  readonly shots: Pick<ShotRepository, 'findById' | 'findByProject' | 'selectTakeIfCurrent'>
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly characters: Pick<CharacterRepository, 'findById'>
  readonly voices: Pick<VoiceProfileRepository, 'findById'>
  readonly takes: TakeRepository
  readonly mediaAssets: MediaAssetRepository
  readonly storage: ObjectStorage
  /** 声の AI ごとの口（`@ixa/provider-voice` の表）。口が無い AI は null。 */
  readonly voiceAdapter: (tool: VoiceToolId) => VoiceAdapter | null
  /** 今の Gemini の鍵の名札（`GEMINI_KEY_LABEL`。秘密ではない）。未設定は null。 */
  readonly keyLabel: string | null
  /** 出来た Take の素材を測る口（大きさ・fps・話している区間）。 */
  readonly mediaQueue: { readonly enqueue: (mediaAssetId: MediaAssetId) => Promise<void> }
  /** セリフの字幕を作り直す鍵（ADR-0061。api と同じもの）。 */
  readonly clipLock: ProjectClipLock
  readonly events: ProjectEventPublisher
  readonly workDir: string
  readonly logger: Logger
}

/** 理由を付けて失敗にする。画面にそのまま出せる日本語の文を持つ。 */
export class DubFailure extends Error {
  readonly failure: DubJobError

  constructor(
    code: string,
    message: string,
    options: { readonly retryable?: boolean; readonly suggestedSpans?: readonly DubLineSpanSuggestion[] } = {},
  ) {
    super(message)
    this.name = 'DubFailure'
    this.failure = {
      code,
      message,
      retryable: options.retryable ?? false,
      ...(options.suggestedSpans === undefined || options.suggestedSpans.length === 0 ? {} : { suggestedSpans: [...options.suggestedSpans] }),
    }
  }
}

/** 人が止めた。失敗ではないので理由を書かずに手を引く。 */
export class DubCancelled extends Error {
  constructor(dubJobId: string) {
    super(`声の差し替え ${dubJobId} は止められました`)
    this.name = 'DubCancelled'
  }
}

/** 順に 1 つずつ（読み上げは同時に頼まない。Gemini の回数の上限に当てない）。 */
export const mapSequential = async <T, R>(items: readonly T[], fn: (item: T, index: number) => Promise<R>): Promise<readonly R[]> =>
  items.reduce<Promise<readonly R[]>>(async (acc, item, index) => [...(await acc), await fn(item, index)], Promise.resolve([]))
