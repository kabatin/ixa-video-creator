'use client'

import type { ViewRange } from '@/lib/waveform-draw'

/** 表示している範囲の中での位置（%）。範囲の外は null（描かない）。 */
export const cueLeftPercent = (sec: number, view: ViewRange): number | null => {
  const span = view.endSec - view.startSec
  if (span <= 0 || sec < view.startSec || sec > view.endSec) return null
  return ((sec - view.startSec) / span) * 100
}

/**
 * 波形の上の歌い出しの印（制作者 2026-10-02「この画面すっごいわかりづらいなー」）。打った所が曲のどこかを見せる。
 *
 * **見るだけ。** 掴めない・押せない（下の波形の押す・ずらすをそのまま通す）。時刻を直すのは打ち直しか一覧から。
 * `WaveformCanvas` の包む要素が `position: relative` なので、`left: %` で時刻に合わせる。
 */
export const LyricCueOverlay = ({
  cues,
  view,
}: {
  readonly cues: readonly number[]
  readonly view: ViewRange
}) => (
  <div aria-hidden="true" className="pointer-events-none absolute inset-0">
    {cues.flatMap((sec, index) => {
      const left = cueLeftPercent(sec, view)
      return left === null
        ? []
        : [
            <span
              key={`${String(index)}:${String(sec)}`}
              data-testid="lyric-cue-mark"
              // 点線にする。セクションの境目（青の実線）・区切り（白の実線）・再生位置（赤）と見分ける。
              className="absolute top-0 bottom-0 border-l border-dashed border-text/70"
              style={{ left: `${String(left)}%` }}
            >
              <span className="absolute top-3 left-0.5 rounded bg-surface/80 px-0.5 text-xs leading-none text-text">
                {String(index + 1)}
              </span>
            </span>,
          ]
    })}
  </div>
)
