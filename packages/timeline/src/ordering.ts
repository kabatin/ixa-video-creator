import { shotEndSec, type Shot, type TimelineClip, type TimelineTrack } from '@ixa/domain'

/**
 * 時間の比較に使う許容誤差。秒は float なので、`0.1 * 3` のような加算の誤差で
 * 「隙間がある」「はみ出している」と誤検知しないようにする。
 */
export const TIME_EPSILON = 1e-6

/**
 * 隣り合っているとみなす差。**1 コマ（60fps で 0.0167 秒）に満たない差**は端数として扱う。
 * 画面の数値は 2 桁で、拍から出た位置は端数を持つので、手で直すと 1 コマ未満の重なり・隙間が残る
 * （ぼくははると: CUT-01 の終わりと CUT-02 の頭の差 0.00016 秒、CUT-02 の終わりが CUT-03 の頭へ 0.0017 秒）。
 * 端のドラッグ・歌い出しに揃える・書き出し前の検査が**同じ幅**を使う（幅が違うと、直せるのに書き出せない）。
 */
export const SHOT_JOIN_TOLERANCE_SEC = 0.01

/**
 * Shot をタイムライン順（`startSec` 昇順）に並べる。**入力は変更しない。**
 * 同時刻のときは `order` で決める。`order` も同じなら入力順を保つ（安定ソート）。
 */
export const sortShotsByStart = (shots: readonly Shot[]): Shot[] =>
  shots
    .map((shot, index) => ({ shot, index }))
    .sort((a, b) => {
      const byStart = a.shot.startSec - b.shot.startSec
      if (byStart !== 0) return byStart
      const byOrder = a.shot.order - b.shot.order
      if (byOrder !== 0) return byOrder
      return a.index - b.index
    })
    .map((entry) => entry.shot)

/**
 * トラックの重ね順（docs/ARCHITECTURE.md §15 の上から順）。
 * VIDEO1 は Shot の投影であり `TimelineClip` を持たないのでここには現れない（ADR-0002）。
 */
const TRACK_ORDER: readonly TimelineTrack[] = ['VFX', 'TEXT', 'VIDEO2', 'SFX']

const trackRank = (track: TimelineTrack): number => {
  const rank = TRACK_ORDER.indexOf(track)
  return rank === -1 ? TRACK_ORDER.length : rank
}

/**
 * クリップを `track` → `layer` の順で安定ソートする。**入力は変更しない。**
 * 同じトラック・同じレイヤーのクリップは入力順を保つ。
 */
export const sortClips = (clips: readonly TimelineClip[]): TimelineClip[] =>
  clips
    .map((clip, index) => ({ clip, index }))
    .sort((a, b) => {
      const byTrack = trackRank(a.clip.track) - trackRank(b.clip.track)
      if (byTrack !== 0) return byTrack
      const byLayer = a.clip.layer - b.clip.layer
      if (byLayer !== 0) return byLayer
      return a.index - b.index
    })
    .map((entry) => entry.clip)

/** Shot 列が覆う終端。Shot が無ければ 0。 */
export const shotsEndSec = (shots: readonly Shot[]): number =>
  shots.reduce((latest, shot) => Math.max(latest, shotEndSec(shot)), 0)

/** クリップ列が覆う終端。クリップが無ければ 0。 */
export const clipsEndSec = (clips: readonly TimelineClip[]): number =>
  clips.reduce((latest, clip) => Math.max(latest, clip.startSec + clip.durationSec), 0)
