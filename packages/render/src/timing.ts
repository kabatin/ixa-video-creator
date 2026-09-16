import { secondsToFrames, type Seconds } from '@ixa/domain'

/** Remotion の `<Sequence>` に渡す区間。 */
export type FrameRange = {
  readonly from: number
  readonly durationInFrames: number
}

/**
 * 秒の区間をフレームの区間へ変換する。
 *
 * 変換は **必ず `@ixa/domain` の `secondsToFrames`（round）を通す**（CLAUDE.md 規約 3）。
 * この関数の中で `Math.round(sec * fps)` を書き直してはいけない。
 *
 * 尺は「開始フレーム」と「終了フレーム」をそれぞれ丸めてから引く。
 * 尺だけを独立に丸めると、隣接する Shot の境界が 1 フレームずれて
 * 黒コマ（すき間）や重なりが生まれるため。
 */
export const frameRange = (startSec: Seconds, durationSec: Seconds, fps: number): FrameRange => {
  const from = secondsToFrames(startSec, fps)
  const end = secondsToFrames(startSec + durationSec, fps)
  return { from, durationInFrames: Math.max(1, end - from) }
}

/** タイムライン全体のフレーム数。0 フレームのコンポジションは Remotion が拒否するため下限 1。 */
export const totalFrames = (durationSec: Seconds, fps: number): number =>
  Math.max(1, secondsToFrames(durationSec, fps))

/** 素材内のシーク位置（`OffthreadVideo` の `startFrom`）。 */
export const sourceOffsetFrames = (inSec: Seconds, fps: number): number =>
  secondsToFrames(inSec, fps)
