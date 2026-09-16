import type {
  CreateReviewFindingInput,
  MusicAnalysis,
  Seconds,
  Shot,
  ShotCamera,
  Take,
} from '@ixa/domain'

/**
 * 決定的レビュアの契約（ADR-0005 Stage 1）。
 *
 * **このパッケージは IO をしない。** ffprobe もフレーム抽出も呼ばない。
 * 測り終えた値を受け取って判定するだけにする。そうしないと、
 * 判定の回帰テストに毎回 ffmpeg が要る（CI で実 API / 実バイナリを叩かない方針と同じ理由）。
 *
 * 測定は呼び出し側（worker）が `@ixa/media` を使って行い、`ReviewMeasurements` に詰める。
 */

/** ffprobe で測った実測値。`@ixa/media` の MediaProbe から worker が詰め替える。 */
export type VideoMeasurement = {
  readonly durationSec: Seconds
  readonly width: number
  readonly height: number
  readonly fps: number
  readonly hasAudioStream: boolean
}

/**
 * 1 フレームの見た目の要約。ピクセルそのものは持ち回らない。
 * `meanLuma` は 0..1。全黒フレームの検出に使う。
 * `colorRatios` は色名 → 画面占有率（0..1）。ブランド色の判定に使う。
 */
export type FrameSample = {
  readonly atSec: Seconds
  readonly meanLuma: number
  readonly colorRatios: Readonly<Record<string, number>>
}

/** 判定に必要な入力一式。worker が組み立てる。 */
export type ReviewMeasurements = {
  readonly take: Take
  readonly shot: Shot
  readonly video: VideoMeasurement
  /** 等間隔に抜いたフレーム。少なくとも 1 枚。空なら判定できないので fail にする。 */
  readonly frames: readonly FrameSample[]
  /** 楽曲解析。未解析なら null（music レビュアは skip になる）。 */
  readonly musicAnalysis: MusicAnalysis | null
  /** Project が要求する出力仕様。技術チェックの基準。 */
  readonly expected: {
    readonly width: number
    readonly height: number
    readonly fps: number
  }
  /** ブランド色の要求。空なら brand レビュアは skip になる。 */
  readonly brandColors: readonly BrandColorRequirement[]
}

/**
 * 「この色が画面のこれだけを占めていること」という要求。
 * `key` は `FrameSample.colorRatios` のキーと一致させる。
 */
export type BrandColorRequirement = {
  readonly key: string
  readonly minRatio: number
  readonly maxRatio: number
}

/**
 * 決定的レビュア。**純粋関数。** 同じ測定値なら必ず同じ指摘を返す。
 * 指摘が無ければ空配列を返す（それが pass を意味する）。
 */
export type DeterministicReviewer = (
  measurements: ReviewMeasurements,
) => readonly CreateReviewFindingInput[]

/** カメラ指示。LLM レビュアが構図判定に使うため再輸出する。 */
export type { ShotCamera }
