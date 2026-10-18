import type { Seconds } from '../common/time.js'
import type { MusicTrack, UpdateMusicTrackPatch } from './music.js'

/**
 * 曲の終わり（`MusicTrack.endSec`）の決まり方。
 *
 * 制作者 2026-10-19「カットの合計尺より音楽が長いと最後に黒画面が出来てしまう。
 * カットより長い部分は楽曲をカットするとか？」。タイムラインの尺は曲の終わりまで伸びるので、
 * 曲の方を止めれば尺もプレビューも書き出しもそこで止まる。
 */

/** ワンクリックで切るときに入れるフェードアウト（秒）。0 のまま切ると音がプツッと切れる。 */
export const MUSIC_TRIM_FADE_OUT_SEC = 0.5

/**
 * タイムライン上で曲が鳴る長さ（秒）。**曲の終わりが無ければ音源の尺のまま**（ミュージックビデオの既定）。
 * 終わりは開始位置から数える。音源より長くは鳴らさず、開始位置より前を指したら 0。
 */
export const musicPlayedDurationSec = (
  track: Pick<MusicTrack, 'offsetSec' | 'endSec'>,
  sourceDurationSec: Seconds,
): Seconds => {
  if (track.endSec === null || track.endSec === undefined) return sourceDurationSec
  return Math.max(0, Math.min(sourceDurationSec, track.endSec - track.offsetSec))
}

/**
 * 曲を `endSec` で切る直し。フェードアウトが 0（無し）なら `MUSIC_TRIM_FADE_OUT_SEC` を入れ、
 * 制作者が決めたフェードアウトは変えない。
 */
export const trimMusicPatch = (
  track: Pick<MusicTrack, 'fadeOutSec'>,
  endSec: Seconds,
): Pick<UpdateMusicTrackPatch, 'endSec' | 'fadeOutSec'> =>
  (track.fadeOutSec ?? 0) > 0 ? { endSec } : { endSec, fadeOutSec: MUSIC_TRIM_FADE_OUT_SEC }
