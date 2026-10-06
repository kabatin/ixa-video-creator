import { MAX_PLAYBACK_RATE, MIN_PLAYBACK_RATE, type Shot } from './shot.js'

/**
 * Take の長さが Shot の尺と違うときの扱い（ADR-0026）。**純粋。IO をしない。**
 *
 * `fit` の Shot は、採用 Take の切り出し位置（`sourceInSec`）から後ろ全体を Shot の尺に収める。
 * 幅（0.5〜2.5 倍）は `shot.ts` が持つ。最長より長い Shot をどこまで作れるかも同じ値で決まる。
 *
 * **ここが唯一の正。** プレビュー・書き出し（`@ixa/timeline`）、タイムラインの検査、
 * 自動レビューの尺の検査（`@ixa/review`）がすべてこの関数を読む。
 * 以前はレビューだけが自前で引き算していて、`fit` を見ていなかったため、
 * 生成尺が編集尺より短くなる Shot（最長の短い AI を選んだとき）が必ず fail になっていた。
 */

/** これより短い不足は数えない（フレームの端数・probe の丸め）。検査と画面が同じ値を使う。 */
export const TAKE_SHORT_TOLERANCE_SEC = 0.05

type TimingShot = Pick<Shot, 'timing' | 'durationSec' | 'sourceInSec'>

/**
 * Take の使える長さ（切り出し位置より後ろ）。
 * **分からない（null）ときと、使えるところが無いときの両方で null を返す。**
 * 呼び出し側はこの 2 つを区別したいことがあるので、`usableTakeSec` を直に使う側が決める。
 */
export const usableTakeSec = (shot: TimingShot, takeDurationSec: number | null): number | null =>
  takeDurationSec === null || takeDurationSec <= shot.sourceInSec
    ? null
    : takeDurationSec - shot.sourceInSec

/** その Shot の再生速度。`trim` と、Take の長さが分からないときは 1。 */
export const shotPlaybackRate = (shot: TimingShot, takeDurationSec: number | null): number => {
  if (shot.timing !== 'fit') return 1
  const usable = usableTakeSec(shot, takeDurationSec)
  if (usable === null) return 1
  return Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, usable / shot.durationSec))
}

/**
 * 速度を考えても Take が足りない秒数。**最後のコマで止まる長さ**。
 * 長さが分からなければ 0（分からないことを「足りない」と言わない）。
 */
export const takeShortfallSec = (shot: TimingShot, takeDurationSec: number | null): number => {
  const usable = usableTakeSec(shot, takeDurationSec)
  if (usable === null) return 0
  const covered = usable / shotPlaybackRate(shot, takeDurationSec)
  return Math.max(0, shot.durationSec - covered)
}
