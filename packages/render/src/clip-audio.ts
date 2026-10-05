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
