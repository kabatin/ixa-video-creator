import type {
  CharacterRepository,
  DubJobRepository,
  MediaAssetRepository,
  ProjectRepository,
  ShotRepository,
  TakeRepository,
  VoiceProfileRepository,
} from '@ixa/db'
import type { DubJobId } from '@ixa/domain'
import type { DesignVoiceRequest, DesignVoiceResult } from '@ixa/provider-voice'
import type { ObjectStorage } from '@ixa/storage'
import type { Logger } from 'pino'

/**
 * キューの名前。**`apps/worker/src/queues.ts` の `QUEUE_NAMES.dub` と一致させること。**
 * apps 同士を import できないので、文字列で合わせるしかない。
 */
export const DUB_QUEUE_NAME = 'dub'

export type DubJobQueue = { readonly enqueue: (dubJobId: DubJobId) => Promise<void> }

/** 声を説明から作る口（Voice Design。ADR-0062）。Gemini の鍵が無い・鍵の名札が未設定なら null。 */
export type VoiceDesignPort = {
  readonly designVoice: (request: DesignVoiceRequest) => Promise<DesignVoiceResult>
  /** 作った鍵の名札（`GEMINI_KEY_LABEL`。秘密ではない）。作った声と一緒に保存する。 */
  readonly keyLabel: string
}

/** 声の差し替え（ADR-0062 段 5b）の API が使うもの。 */
export type DubRoutesDeps = {
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly shots: Pick<ShotRepository, 'findById'>
  readonly takes: Pick<TakeRepository, 'findById'>
  readonly mediaAssets: Pick<MediaAssetRepository, 'findById' | 'findByChecksum' | 'create'>
  readonly dubJobs: DubJobRepository
  readonly dubQueue: DubJobQueue
  readonly characters: Pick<CharacterRepository, 'findById' | 'update'>
  readonly voices: Pick<VoiceProfileRepository, 'findById' | 'findByName' | 'create'>
  readonly storage: ObjectStorage
  /** 声を説明から作る口。無ければ「説明から声を作る」は断る（理由を言う）。 */
  readonly voiceDesign: VoiceDesignPort | null
  readonly logger: Logger
}
