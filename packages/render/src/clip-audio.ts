import { fadeGainAt } from '@ixa/domain'

/**
 * 音のクリップ（効果音）の音量（ADR-0039）。フェードが無ければ決まった値、あればクリップの頭からのコマで変わる
 * （Remotion の `<Audio volume>` は、コマごとの関数を受ける。頭は Sequence の頭 = クリップの頭）。
 */
export const clipAudioVolume = (
  clip: { readonly volume: number; readonly durationSec: number; readonly fadeInSec?: number; readonly fadeOutSec?: number },
  fps: number,
): number | ((frame: number) => number) => {
  const fadeInSec = clip.fadeInSec ?? 0
  const fadeOutSec = clip.fadeOutSec ?? 0
  if (fadeInSec <= 0 && fadeOutSec <= 0) return clip.volume
  return (frame) => clip.volume * fadeGainAt(frame / fps, { startSec: 0, durationSec: clip.durationSec, fadeInSec, fadeOutSec })
}

/**
 * 採用 Take の音の音量（ADR-0060）。切り口の頭と尻を弱め、プツッと鳴らさない。Remotion の `volume` はコマごとにしか
 * 変えられないので、ffmpeg の `afade`（サンプルごと）に近づけるよう次のようにする。
 *
 * - フェードの長さは `fadeSec` と 1 コマのうち長いほう（24fps で 20ms だと、頭のコマが 0 になって 42ms 消え、
 *   尻のコマはフェードの前で 1 のまま終わっていた）
 * - コマの**真ん中**の時刻で引く（頭と尻のコマは弱まるが 0 にはならない）
 */
export const takeAudioVolume = (
  audio: { readonly volume: number; readonly durationSec: number },
  fps: number,
  fadeSec: number,
): ((frame: number) => number) => {
  const fade = Math.max(fadeSec, 1 / fps)
  return (frame) =>
    audio.volume * fadeGainAt((frame + 0.5) / fps, { startSec: 0, durationSec: audio.durationSec, fadeInSec: fade, fadeOutSec: fade })
}
