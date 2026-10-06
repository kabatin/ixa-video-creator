import {
  TAKE_SHORT_TOLERANCE_SEC,
  takeShortfallSec,
  type CreateReviewFindingInput,
  type Seconds,
  type Severity,
  type Shot,
} from '@ixa/domain'
import type { DeterministicReviewer, FrameSample, ReviewMeasurements } from './port.js'

/**
 * technical レビュア（ADR-0005 Stage 1 / ARCHITECTURE.md §12）。
 * 尺・解像度・fps・全黒フレーム・静止画化・音声ストリームを、測り終えた値だけで判定する。
 *
 * **純粋関数。** IO も時計も乱数も使わない。同じ測定値なら必ず同じ指摘を返す。
 */

/**
 * 尺の許容誤差（秒）。
 * エンコーダは尺をフレーム境界へ丸めるため、1 フレーム分のズレは正常な範囲。
 * 本システムが扱う最小の 24fps で 1 フレーム = 0.0417 秒なので、それをわずかに上回る値にする。
 */
export const DURATION_TOLERANCE_SEC = 0.05

/**
 * fps の許容誤差（相対値）。
 * NTSC 系のレートは 30000/1001 = 29.97 のように名目値と 1/1001（約 0.1%）ずれる。
 * これを不一致として扱うと実素材のほとんどが warn になるため、その倍の 0.2% まで許す。
 */
export const FPS_TOLERANCE_RATIO = 0.002

/**
 * アスペクト比の許容誤差（相対値）。
 * コーデックは縦横を 16px 単位へ揃えるため、1080 が 1088 になることがある（+0.74%）。
 * この程度の差はクロップで吸収できるので、同じ比として扱う。
 */
export const ASPECT_RATIO_TOLERANCE = 0.01

/**
 * 全黒とみなす平均輝度の上限（`meanLuma` は 0..1）。
 * 真っ黒なフレームでもコーデックのノイズで 0 にはならないが、0.01 は超えない。
 * 一方、夜間の暗いカットでも平均輝度は 0.05 を超える。その間を取る。
 */
export const BLACK_FRAME_MAX_MEAN_LUMA = 0.02

/**
 * 静止画化とみなす平均輝度の振れ幅（max - min）。
 * 同一フレームが続く場合、測定値の差は丸め誤差だけなので 0.005 に届かない。
 * 被写体やカメラが動いていれば平均輝度はこれ以上に振れる。
 */
export const STATIC_LUMA_RANGE = 0.005

/**
 * 静止画化の判定に最低限必要なフレーム数。
 * 2 枚では「たまたま輝度が近い」を排除できず、誤検出が増える。
 */
export const MIN_FRAMES_FOR_STATIC_CHECK = 3

const sec = (value: number): string => `${value.toFixed(2)}s`
const px = (width: number, height: number): string => `${String(width)}x${String(height)}`

type FindingDraft = {
  readonly severity: Severity
  readonly message: string
  readonly frameSec?: Seconds | null
}

const finding = (draft: FindingDraft): CreateReviewFindingInput => ({
  reviewer: 'technical',
  severity: draft.severity,
  // 技術チェックは「合っているか」の二値判定なので、連続値の score は付けない。
  score: null,
  message: draft.message,
  evidence: { frameSec: draft.frameSec ?? null, bbox: null, comparedAssetId: null },
  /**
   * ARCHITECTURE.md §13 のとおり technical の fail はパラメータ側（尺・解像度・モデル）で直す。
   * プロンプトを足しても直らないため、ここでは常に null を返す。
   * 再生成ループに「もっと良くして」に類する文字列を渡さないこと。
   */
  suggestedPromptDelta: null,
})

/** 編集で実際に使う区間 `[sourceInSec, sourceInSec + durationSec)`。end は排他（TimeRange と同じ規約）。 */
const isWithinUsedRange = (frame: FrameSample, shot: Shot): boolean =>
  frame.atSec >= shot.sourceInSec && frame.atSec < shot.sourceInSec + shot.durationSec

const checkDuration = (m: ReviewMeasurements): readonly CreateReviewFindingInput[] => {
  const { shot, video, take } = m
  const usableSec = video.durationSec - shot.sourceInSec

  /** 切り出し位置より短い素材は、速度では救えない（使えるところが 1 コマも無い）。 */
  if (usableSec <= 0) {
    return [
      finding({
        severity: 'fail',
        message:
          `素材が切り出し位置より短い。sourceIn ${sec(shot.sourceInSec)} に対して ` +
          `素材は ${sec(video.durationSec)} しかない`,
        frameSec: video.durationSec,
      }),
    ]
  }

  /**
   * **速度を考えてから「足りない」と言う（ADR-0026）。**
   *
   * `fit` の Shot は Take 全体を Shot の尺へ収める（0.5〜2.5 倍）ので、素材が編集尺より短いこと
   * 自体は異常ではない。**最長が短いモデルを選べば必ず起きる**（Wan 2.2 5B は 5 秒まで。ADR-0040）。
   *
   * 判定は domain の `takeShortfallSec` 1 か所に任せる。再生・書き出し（`@ixa/timeline`）と
   * タイムラインの検査が同じ関数を読んでいるので、**画面で足りていないものだけが fail になる。**
   * 以前はここだけが自前で引き算していて `timing` を見ていなかったため、ゆっくり再生で
   * 埋まっている Shot まで fail にしていた。
   */
  const shortfallSec = takeShortfallSec(shot, video.durationSec)
  if (shortfallSec > TAKE_SHORT_TOLERANCE_SEC) {
    const speed = shot.timing === 'fit' ? '最も遅い再生にしても' : ''
    return [
      finding({
        severity: 'fail',
        message:
          `素材が編集尺に足りない。sourceIn ${sec(shot.sourceInSec)} から使えるのは ` +
          `${sec(usableSec)} で、${speed}編集尺 ${sec(shot.durationSec)} に ` +
          `${sec(shortfallSec)} 足りない`,
        frameSec: video.durationSec,
      }),
    ]
  }

  /**
   * 生成尺（ADR-0011 でモデルの対応値へ切り上げた値）と実測尺のズレ。
   * 編集尺が取れている以上タイムラインは壊れないので fail にはしない。
   * Provider が要求どおりの尺を返さなかった事実として warn で残す。
   */
  const requestedSec = take.spec.durationSec
  if (Math.abs(video.durationSec - requestedSec) > DURATION_TOLERANCE_SEC) {
    return [
      finding({
        severity: 'warn',
        message: `実測尺 ${sec(video.durationSec)} が生成尺 ${sec(requestedSec)} と一致しない`,
        frameSec: video.durationSec,
      }),
    ]
  }

  return []
}

const hasSameAspectRatio = (
  measured: { readonly width: number; readonly height: number },
  expected: { readonly width: number; readonly height: number },
): boolean => {
  const wanted = expected.width / expected.height
  return Math.abs(measured.width / measured.height - wanted) / wanted <= ASPECT_RATIO_TOLERANCE
}

const checkResolution = (m: ReviewMeasurements): readonly CreateReviewFindingInput[] => {
  const { video, expected } = m
  if (video.width === expected.width && video.height === expected.height) return []

  const label = `解像度 ${px(video.width, video.height)}（要求 ${px(expected.width, expected.height)}）`

  // 要求より大きく、比も同じなら縮小するだけで使える。画質も落ちないので info に留める。
  if (
    video.width >= expected.width &&
    video.height >= expected.height &&
    hasSameAspectRatio(video, expected)
  ) {
    return [finding({ severity: 'info', message: `${label} は要求より大きいが同じ比。縮小して使える` })]
  }

  return [finding({ severity: 'fail', message: `${label} が一致しない` })]
}

const checkFps = (m: ReviewMeasurements): readonly CreateReviewFindingInput[] => {
  const { video, expected } = m
  const difference = Math.abs(video.fps - expected.fps) / expected.fps
  if (difference <= FPS_TOLERANCE_RATIO) return []

  /**
   * フレームレート変換はレンダリング側（`@ixa/media`）で吸収できるため fail にしない。
   * ただし変換はフレームの間引き・複製を伴い動きの滑らかさが落ちるので、黙って通さず warn にする。
   */
  return [
    finding({
      severity: 'warn',
      message:
        `fps ${video.fps.toFixed(3)} が要求 ${expected.fps.toFixed(3)} と一致しない。` +
        'フレームレート変換が必要',
    }),
  ]
}

/** この sourceType では静止していることが正しいので、静止画化の判定をしない。 */
const isStillSourceType = (shot: Shot): boolean =>
  shot.sourceType.type === 'still_image' || shot.sourceType.type === 'generated_graphic'

const checkStatic = (m: ReviewMeasurements): readonly CreateReviewFindingInput[] => {
  const { frames, shot } = m
  if (isStillSourceType(shot)) return []
  if (frames.length < MIN_FRAMES_FOR_STATIC_CHECK) return []

  const lumas = frames.map((frame) => frame.meanLuma)
  const range = Math.max(...lumas) - Math.min(...lumas)
  if (range > STATIC_LUMA_RANGE) return []

  /**
   * `meanLuma` は明るさしか見ていない。均一に照らされた壁をパンするような素材でも
   * 平均輝度は動かないため、これだけで「静止している」と断定はできない。
   * よって fail ではなく warn にし、最終判断は人間か LLM 層へ回す。
   */
  return [
    finding({
      severity: 'warn',
      message:
        `全 ${String(frames.length)} フレームの平均輝度がほぼ同一（振れ幅 ${range.toFixed(4)}）。` +
        '静止画化している可能性がある',
      frameSec: frames[0]?.atSec ?? null,
    }),
  ]
}

const checkFrames = (m: ReviewMeasurements): readonly CreateReviewFindingInput[] => {
  const { frames, shot } = m

  if (frames.length === 0) {
    return [
      finding({
        severity: 'fail',
        message: 'フレームが 1 枚も無い。全黒フレームと静止画化を判定できない',
      }),
    ]
  }

  const blackFrames = frames.filter((frame) => frame.meanLuma < BLACK_FRAME_MAX_MEAN_LUMA)

  if (blackFrames.length === frames.length) {
    return [
      finding({
        severity: 'fail',
        message: `全 ${String(frames.length)} フレームが黒。素材として使えない`,
        frameSec: frames[0]?.atSec ?? null,
      }),
    ]
  }

  const insideUsedRange = blackFrames.filter((frame) => isWithinUsedRange(frame, shot))

  if (insideUsedRange.length > 0) {
    return [
      finding({
        severity: 'fail',
        message: `編集で使う区間に黒フレームが ${String(insideUsedRange.length)} 枚ある`,
        frameSec: insideUsedRange[0]?.atSec ?? null,
      }),
      ...checkStatic(m),
    ]
  }

  if (blackFrames.length > 0) {
    // 使う区間の外＝ADR-0011 の「のりしろ」。sourceInSec の調整で避けられるので info。
    return [
      finding({
        severity: 'info',
        message:
          `のりしろ部分に黒フレームが ${String(blackFrames.length)} 枚ある。` +
          '編集では使わないが、トランジションに使うならイン点を見直すこと',
        frameSec: blackFrames[0]?.atSec ?? null,
      }),
      ...checkStatic(m),
    ]
  }

  return checkStatic(m)
}

const checkAudio = (m: ReviewMeasurements): readonly CreateReviewFindingInput[] => {
  if (m.video.hasAudioStream) return []

  /**
   * 音声ストリームが無いことは欠陥ではない。Kling / Seedance は音声を返さないし、
   * MV の音は音楽トラックから載せるので、無音のまま採用して問題ない。
   * ただしタイムライン側が「音があるつもり」で組むと事故になるため、事実として info を残す。
   */
  return [finding({ severity: 'info', message: '音声ストリームが無い。音は音楽トラックから載せること' })]
}

export const technicalReviewer: DeterministicReviewer = (measurements) => [
  ...checkDuration(measurements),
  ...checkResolution(measurements),
  ...checkFps(measurements),
  ...checkFrames(measurements),
  ...checkAudio(measurements),
]
