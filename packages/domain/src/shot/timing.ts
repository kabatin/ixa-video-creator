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

/** `speed` は省けば 1（速さを持たない古い呼び出し・試算）。 */
type TimingShot = Pick<Shot, 'timing' | 'durationSec' | 'sourceInSec'> & { readonly speed?: number }

const speedOf = (shot: TimingShot): number => shot.speed ?? 1

/**
 * AI に頼む長さの元（切り上げる前。ADR-0050）。`trim` は尺 × 速さ、`fit` は尺のまま
 * （`fit` は出来た Take の長さから速さを決めるので、頼む長さは変えない）。
 * **速さ 1 なら今までと同じ値**（仕様のハッシュが変わらない）。
 */
export const requestedSourceSec = (shot: TimingShot): number =>
  shot.timing === 'fit' ? shot.durationSec : shot.durationSec * speedOf(shot)

/**
 * Take の使える長さ（切り出し位置より後ろ）。
 * **分からない（null）ときと、使えるところが無いときの両方で null を返す。**
 * 呼び出し側はこの 2 つを区別したいことがあるので、`usableTakeSec` を直に使う側が決める。
 */
export const usableTakeSec = (shot: TimingShot, takeDurationSec: number | null): number | null =>
  takeDurationSec === null || takeDurationSec <= shot.sourceInSec
    ? null
    : takeDurationSec - shot.sourceInSec

/**
 * その Shot の再生速度。
 * - `trim`: 選んだ速さ。**速めたのに Take が足りなければ、足りるところまで落とす**（1 倍より下げない。
 *   それでも足りなければ今までどおり最後のコマで止まる）。速さを上げただけで絵が止まるのを避ける
 * - `fit`: Take 全体を尺に収める速さ
 * Take の長さが分からなければ、`trim` は選んだ速さ、`fit` は 1。
 */
export const shotPlaybackRate = (shot: TimingShot, takeDurationSec: number | null): number => {
  const usable = usableTakeSec(shot, takeDurationSec)
  if (shot.timing !== 'fit') {
    const speed = speedOf(shot)
    if (speed <= 1 || usable === null) return speed
    return Math.min(speed, Math.max(1, usable / shot.durationSec))
  }
  if (usable === null) return 1
  return Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, usable / shot.durationSec))
}

/**
 * Take の中で実際に画面に出る区間の終わり（秒。排他）。速さ（ADR-0050）と fit を掛けた後の長さ。
 * 自動レビューが「観客が見る区間」だけを判定するのに使う。
 */
export const usedSourceEndSec = (shot: TimingShot, takeDurationSec: number | null): number =>
  shot.sourceInSec + shot.durationSec * shotPlaybackRate(shot, takeDurationSec)

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

/**
 * Take の秒をタイムラインの秒に直す（ADR-0054 §4）。
 * `shot.startSec + (takeSec − sourceInSec) / shotPlaybackRate`。
 * **Shot に映る範囲（`sourceInSec` 〜 `usedSourceEndSec`。終わりは排他）の外は null。**
 */
export const takeSecToTimelineSec = (
  shot: TimingShot & Pick<Shot, 'startSec'>,
  takeSec: number,
  takeDurationSec: number | null,
): number | null => {
  if (takeSec < shot.sourceInSec || takeSec >= usedSourceEndSec(shot, takeDurationSec)) return null
  return shot.startSec + (takeSec - shot.sourceInSec) / shotPlaybackRate(shot, takeDurationSec)
}
