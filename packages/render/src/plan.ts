import type {
  RenderableClip,
  Resolution,
  ShotId,
  TimelineClipId,
  TimelineDocument,
  TimelineTrack,
  Transition,
  TransitionType,
} from '@ixa/domain'
import { isDegradedTransition } from '@ixa/domain'
import { letterboxFit, type FitRect } from './presets.js'
import { frameRange, sourceOffsetFrames, totalFrames, type FrameRange } from './timing.js'

/**
 * トランジションの実装状況。**Phase 1 で未実装のものを無言で無視しないための表**。
 *
 * - `cut`         : 何もしない（Shot を隣接させるだけ）
 * - `dissolve`    : 前の Shot の尻を次の Shot に重ね、不透明度を 1→0 で補間する
 * - `dip_to_black`: 境界をまたいで黒の単色を挟む（0→1→0）
 * - `dip_to_white`: 同上（白）
 * - `wipe` / `whip_pan` / `glitch`
 *     : **Phase 1 では未実装。`cut` と同じ扱いに縮退する。**
 *       ワイプのマスク、ホイップパンのモーションブラー、グリッチのシェーダは
 *       いずれもモーショングラフィックス機構（Phase 5）の上に載せるべきもので、
 *       中途半端な近似を入れると後で捨てることになるため、あえて実装しない。
 *       縮退したことは `TimelinePlan.degradedTransitions` で呼び出し側に見える。
 */
/**
 * 表の実体は `@ixa/domain` にある。画面・検証・レンダラが同じ答えを見るため。
 * ここでは再輸出するだけで、**値をここに書かない**。
 */
export { TRANSITION_SUPPORT } from '@ixa/domain'

const DIP_COLOR: Partial<Record<TransitionType, string>> = {
  dip_to_black: '#000000',
  dip_to_white: '#ffffff',
}

/** VIDEO1 の Shot 1 つ分の配置。 */
export type ShotPlan = {
  readonly shotId: ShotId
  readonly mediaUrl: string
  /** ディゾルブの尻（fadeOutFrames）を含んだ区間。 */
  readonly range: FrameRange
  /** 素材内のシーク位置（`inSec` 由来）。 */
  readonly startFrom: number
  /** 末尾のクロスディゾルブ長。0 ならディゾルブ無し。 */
  readonly fadeOutFrames: number
  readonly zIndex: number
  /** 再生速度（ADR-0026）。尺に合わせる Shot だけ 1 以外。 */
  readonly playbackRate: number
}

/** dip_to_black / dip_to_white で挟む単色。 */
export type DipPlan = {
  readonly transitionId: string
  readonly color: string
  readonly range: FrameRange
  readonly zIndex: number
}

export type ClipPlan = {
  readonly clipId: TimelineClipId
  readonly track: TimelineTrack
  readonly range: FrameRange
  readonly opacity: number
  readonly zIndex: number
  readonly content: RenderableClip['content']
}

export type AudioPlan = {
  readonly mediaUrl: string
  readonly range: FrameRange
  readonly volume: number
}

/** 実装されておらず `cut` に縮退したトランジション。 */
export type DegradedTransition = {
  readonly transitionId: string
  readonly type: TransitionType
}

export type TimelinePlan = {
  readonly fps: number
  readonly durationInFrames: number
  /** 出力キャンバス（プリセット解像度）。 */
  readonly canvas: Resolution
  /** キャンバス内で映像を置く矩形（レターボックス）。 */
  readonly video: FitRect
  readonly shots: readonly ShotPlan[]
  readonly dips: readonly DipPlan[]
  readonly clips: readonly ClipPlan[]
  readonly audio: readonly AudioPlan[]
  readonly degradedTransitions: readonly DegradedTransition[]
}

/** VIDEO2 → VFX → TEXT の順に上へ重ねる。SFX は音声のみで映像を持たない。 */
const TRACK_ORDER: Readonly<Record<TimelineTrack, number>> = {
  VIDEO2: 0,
  VFX: 1,
  TEXT: 2,
  SFX: 3,
}

const SHOT_Z_BASE = 100

const findOutgoing = (
  transitions: readonly Transition[],
  shotId: ShotId,
): Transition | undefined => transitions.find((t) => t.fromShotId === shotId)

/**
 * Shot の重ね順は **後ろの Shot ほど下**にする。
 * ディゾルブは「前の Shot の尻を次の Shot の上に重ねて消す」方式で実装しており、
 * DOM 順どおり（後ろが上）だと尻が次の Shot に隠れてしまうため。
 */
const shotZIndex = (index: number, count: number): number => SHOT_Z_BASE + (count - index)

const buildShots = (doc: TimelineDocument): readonly ShotPlan[] =>
  doc.video1.map((shot, index) => {
    const outgoing = findOutgoing(doc.transitions, shot.shotId)
    const isDissolve =
      outgoing !== undefined &&
      !isDegradedTransition(outgoing.type) &&
      outgoing.type === 'dissolve' &&
      outgoing.durationSec > 0

    const fadeOutFrames = isDissolve
      ? frameRange(shot.startSec + shot.durationSec, outgoing.durationSec, doc.fps).durationInFrames
      : 0

    const body = frameRange(shot.startSec, shot.durationSec, doc.fps)
    return {
      shotId: shot.shotId,
      mediaUrl: shot.mediaUrl,
      range: { from: body.from, durationInFrames: body.durationInFrames + fadeOutFrames },
      startFrom: sourceOffsetFrames(shot.inSec, doc.fps),
      fadeOutFrames,
      zIndex: shotZIndex(index, doc.video1.length),
      playbackRate: shot.playbackRate ?? 1,
    }
  })

/**
 * dip は Shot の境界（前の Shot の終端）を中心に置く。
 * タイムラインを伸ばさずに単色を挟むには、境界の前後半分ずつを食うしかない。
 */
const buildDips = (doc: TimelineDocument, dipZIndex: number): readonly DipPlan[] =>
  doc.video1.flatMap((shot) => {
    const outgoing = findOutgoing(doc.transitions, shot.shotId)
    if (outgoing === undefined || outgoing.durationSec <= 0) return []
    const color = DIP_COLOR[outgoing.type]
    if (color === undefined) return []

    const boundary = shot.startSec + shot.durationSec
    const start = Math.max(0, boundary - outgoing.durationSec / 2)
    return [
      {
        transitionId: outgoing.id,
        color,
        range: frameRange(start, outgoing.durationSec, doc.fps),
        zIndex: dipZIndex,
      },
    ]
  })

const buildClips = (doc: TimelineDocument, baseZIndex: number): readonly ClipPlan[] =>
  doc.clips.map((clip) => ({
    clipId: clip.id,
    track: clip.track,
    range: frameRange(clip.startSec, clip.durationSec, doc.fps),
    opacity: clip.opacity,
    zIndex: baseZIndex + TRACK_ORDER[clip.track] * 1000 + clip.layer,
    content: clip.content,
  }))

const buildAudio = (doc: TimelineDocument): readonly AudioPlan[] =>
  doc.audio.map((track) => ({
    mediaUrl: track.mediaUrl,
    range: frameRange(track.startSec, track.durationSec, doc.fps),
    volume: track.volume,
  }))

const buildDegraded = (doc: TimelineDocument): readonly DegradedTransition[] =>
  doc.transitions
    .filter((t) => isDegradedTransition(t.type))
    .map((t) => ({ transitionId: t.id, type: t.type }))

/**
 * `TimelineDocument` を「React に描かせる配置表」へ畳む純粋関数。
 *
 * React から切り離してあるのは、タイミング計算をブラウザ無しでテストできるようにするため。
 * 入力は一切変更しない（CLAUDE.md 規約 1）。
 *
 * `canvas` はプリセット解像度。`doc.resolution` と食い違うときは
 * **プリセットを優先し、映像はアスペクト比を保って収める**（`letterboxFit` のコメント参照）。
 */
export const buildTimelinePlan = (doc: TimelineDocument, canvas: Resolution): TimelinePlan => {
  const dipZIndex = SHOT_Z_BASE + doc.video1.length + 1
  return {
    fps: doc.fps,
    durationInFrames: totalFrames(doc.durationSec, doc.fps),
    canvas: { ...canvas },
    video: letterboxFit(doc.resolution, canvas),
    shots: buildShots(doc),
    dips: buildDips(doc, dipZIndex),
    clips: buildClips(doc, dipZIndex + 1),
    audio: buildAudio(doc),
    degradedTransitions: buildDegraded(doc),
  }
}
