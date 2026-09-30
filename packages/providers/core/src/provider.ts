import type { MediaAssetId, ModelId, ProviderId, ShotGenerationSpec } from '@ixa/domain'
import type { ModelEconomics, ModelQualities, VideoModelCapabilities } from './capabilities.js'

/** モデル 1 つ分の宣言。capability はバリデーション、qualities は Router のスコアリングに使う。 */
export type VideoModelDescriptor = {
  readonly id: ModelId
  readonly providerId: ProviderId
  readonly label: string
  readonly capabilities: VideoModelCapabilities
  readonly qualities: ModelQualities
  readonly economics: ModelEconomics
  /**
   * AUTO（Model Router）の候補にするか。**省略は候補にする。**
   * ローカルの画像→動画は false（ADR-0025）。最初のフレームを付けただけで AUTO が
   * 無料の寄りへ切り替わると、生成を頼んだつもりが画像を動かすだけになる。明示して選ばせる。
   */
  readonly routable?: boolean
}

/** Provider 側のジョブを指す不透明なハンドル。中身の形は Provider ごとに異なる。 */
export type ProviderJobHandle = {
  readonly providerId: ProviderId
  readonly modelId: ModelId
  readonly ref: string
  readonly submittedAt: Date
}

export type ProviderJobStatus =
  | { readonly state: 'pending' | 'running'; readonly progress: number | null }
  | {
      readonly state: 'succeeded'
      readonly output: ProviderOutput
      readonly seedUsed: number | null
      readonly costUsd: number
      readonly raw: Record<string, unknown>
    }
  | {
      readonly state: 'failed'
      readonly error: { readonly code: string; readonly message: string; readonly retryable: boolean }
    }

/**
 * 生成物の所在。**リモートとローカルを型で区別する。**
 *
 * リモート URL は Provider が返す外部由来の値であり、SSRF の検査対象になる。
 * 一方ローカル Provider（スタブなど）の出力は自プロセスが書いたファイルで、
 * 攻撃者の制御下にない。これを同じ `string` で扱うと、
 * どちらかに合わせて検査を緩めるか、正しい経路が塞がれるかのどちらかになる。
 */
export type ProviderOutput =
  | {
      readonly type: 'remote'
      /** 期限付き URL。**DB に保存せず即ダウンロードすること**（ARCHITECTURE.md §9） */
      readonly url: string
    }
  | {
      readonly type: 'local'
      /** 自プロセスが書いたファイルの絶対パス。HTTP を経由しない。 */
      readonly path: string
    }

/** Domain から Provider へ渡す要求。参照は解決済みのアセット ID で渡す。 */
export type VideoGenerationRequest = {
  readonly model: VideoModelDescriptor
  readonly spec: ShotGenerationSpec
  /** 参照アセットを Provider が読める形にするための解決関数（署名付き URL やローカルパス）。 */
  readonly resolveReference: (id: MediaAssetId) => Promise<string>
  /**
   * 同じ生成の投入を見分ける鍵（ADR-0030）。**同じ鍵で投げ直したら、Provider は新しく作らず同じジョブを返す。**
   * worker は GenerationJob の ID を渡す。投入の応答が途中で失われても、投げ直しで二重に生成しない。
   * 対応する Provider（vpipe）だけが使い、ほかは無視してよい。省略は「鍵なし」（投げ直しは新しい生成）。
   */
  readonly idempotencyKey?: string
}

/**
 * 投入後の問い合わせの間隔と回数（ADR-0030）。**省略は worker の既定**
 * （5 秒から倍々に伸ばして最大 2 分おき・60 回 ≈ 約 2 時間）。
 *
 * 既定は、遠くの有料 API を叩きすぎず、長い生成も待てるように決めてある。
 * 手元のサーバのように問い合わせが安く、終わりにすぐ気付きたい Provider だけが細かくする。
 * 間隔を縮めるなら回数を増やし、`maxAttempts` 回で待てる時間が最悪の生成時間を覆うようにすること。
 */
export type PollPolicy = {
  /** 間隔の上限（ミリ秒）。5 秒から倍々に伸ばし、ここで頭打ちにする。 */
  readonly maxIntervalMs: number
  /** これを超えたら諦めて failed にする回数。 */
  readonly maxAttempts: number
}

/**
 * すべての動画 Provider が実装する interface。
 * HTTP・CLI・ローカルのいずれの形態でもこの形に合わせる（ADR-0004 / 0012 / 0014）。
 * 同期 API しか無い Provider も「即座に完了するジョブ」として包むこと。
 */
export interface VideoProvider {
  readonly id: ProviderId
  readonly models: readonly VideoModelDescriptor[]
  /** 問い合わせの間隔と回数。省略は worker の既定（`PollPolicy`）。 */
  readonly pollPolicy?: PollPolicy
  submit(request: VideoGenerationRequest): Promise<ProviderJobHandle>
  poll(handle: ProviderJobHandle): Promise<ProviderJobStatus>
  cancel(handle: ProviderJobHandle): Promise<void>
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly providerId: ProviderId,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'ProviderError'
  }
}

/**
 * Provider が「いまは受け付けられない。後で**同じ投入を**やり直して」と答えた（ADR-0030）。
 *
 * 1 本ずつしか作れない手元の生成サーバ（vpipe-api）は、走っている 1 本と待ちの枠が埋まると
 * 投入を 429 で断る。これは入力の誤りでも故障でもなく「後で来て」なので、普通の失敗と
 * 同じ扱いで終端にすると、まとめて頼んだ生成が 2 本目以降すべて失敗になる。
 * 投入する側（worker）はこれを見分けて、ジョブを失敗にせず時間を置いて投入し直す。
 *
 * もう 1 つの場合: 投入を送ったのに応答が失われた（時間切れ・切断・5xx）。受け付けられたかは
 * 分からないが、`idempotencyKey` を付けて投げ直せば Provider は同じジョブを返すので、
 * 失敗と決めつけずにこれで知らせる。**鍵が無い投入ではこの形で知らせてはいけない**（二重に生成しうる）。
 *
 * どちらも、投げ直して新たな費用や二重の生成が起きることは無い。やり直せる（`retryable` は常に true）。
 */
export class ProviderBusyError extends ProviderError {
  constructor(
    message: string,
    providerId: ProviderId,
    /** Provider が示した待ち時間（ミリ秒）。示されなければ null（待つ長さは呼び出し側が決める）。 */
    readonly retryAfterMs: number | null,
    options?: { cause?: unknown },
  ) {
    super(message, providerId, true, options)
    this.name = 'ProviderBusyError'
  }
}

export class CapabilityViolationError extends Error {
  constructor(readonly modelId: ModelId, readonly violations: readonly string[]) {
    super(`モデル ${modelId} では次の要求を満たせません:\n- ${violations.join('\n- ')}`)
    this.name = 'CapabilityViolationError'
  }
}
