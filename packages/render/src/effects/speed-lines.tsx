import type { SpeedLinesParams } from '@ixa/domain'
import type React from 'react'
import { fadeInOut } from './envelope.js'
import { OverlayBox, r4, type OverlayProps } from './overlay-box.js'
import { randomAt } from './random.js'

/**
 * スピード線（ADR-0050）。**漫画の集中線ではなく、映像の光の筋**として描く。
 *
 * 最初の版は一様な太さの白い直線で、2 コマごとに置き直していた。画面に線が貼り付いて見え、
 * 中央の被写体にも掛かって安っぽかった（2026-10-17 の制作者のフィードバック）。いまは:
 * - 筋は**外へ流れる**（同じ筋がコマごとに進み、寿命が来たら別の場所に生まれ直す）
 * - 筋は**先細り**で、**中央は空ける**（中心から離れるほど明るい）
 * - **ぼかして** `screen` で重ねる（暗部は残り、光だけが足される）
 * - 周りを少し暗くして（周辺減光）、視線を中央へ寄せる
 */

/** 筋の数の幅。線の多さ 0 で最少、1 で最多。多すぎると白く濁る。 */
const MIN_STREAKS = 16
const MAX_STREAKS = 64

/** 筋が生まれてから消えるまでのコマ数の幅（24fps で約 0.2〜0.35 秒）。 */
const MIN_LIFE_FRAMES = 5
const LIFE_FRAMES_RANGE = 4

/** 中央の空ける広さ（放射なら画面の対角の半分に対する割合、横なら高さに対する割合）。 */
const RADIAL_CLEAR = 0.38
const HORIZONTAL_CLEAR_TOP = 0.3
const HORIZONTAL_CLEAR_BOTTOM = 0.7

/** 筋の色（わずかに暖かい白。真っ白だと絵から浮く）。 */
const STREAK_COLOR = '#fff4e6'

export type SpeedStreak = {
  /** SVG の polygon の点（映像の矩形の座標）。 */
  readonly points: string
  readonly opacity: number
}

type Lifecycle = { readonly cycle: number; readonly progress: number }

/** 筋 i が今どの生まれ変わりの何割目にいるか。寿命と出だしのずれは筋ごとに種で決まる。 */
const lifecycle = (seed: number, i: number, frame: number): Lifecycle => {
  const life = MIN_LIFE_FRAMES + Math.floor(randomAt(seed, i * 7) * LIFE_FRAMES_RANGE)
  const t = frame + Math.floor(randomAt(seed, i * 7 + 1) * life)
  return { cycle: Math.floor(t / life), progress: (t % life) / life }
}

const pt = (x: number, y: number): string => `${String(r4(x))},${String(r4(y))}`

/** 生まれて明るくなり、消えていく（寿命の中ほどで最も明るい）。 */
const lifeOpacity = (progress: number, base: number): number => r4(base * Math.sin(Math.PI * progress))

const radialStreak = (seed: number, i: number, frame: number, width: number, height: number): SpeedStreak => {
  const { cycle, progress } = lifecycle(seed, i, frame)
  const at = (k: number): number => randomAt(seed, (cycle * MAX_STREAKS + i) * 6 + k)
  const half = Math.hypot(width, height) / 2
  const unit = height / 1080
  const angle = at(0) * Math.PI * 2
  // 筋の尻が中央の空けた縁から外へ走り抜ける。
  const tail = half * (RADIAL_CLEAR + 0.75 * progress)
  const head = tail + half * (0.2 + 0.3 * at(1))
  const spread = (unit * (3 + 9 * at(2))) / 2
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const cx = width / 2
  const cy = height / 2
  return {
    // 尻は点、頭に幅（外ほど太い楔）。
    points: [
      pt(cx + cos * tail, cy + sin * tail),
      pt(cx + cos * head - sin * spread, cy + sin * head + cos * spread),
      pt(cx + cos * head + sin * spread, cy + sin * head - cos * spread),
    ].join(' '),
    opacity: lifeOpacity(progress, 0.45 + 0.55 * at(3)),
  }
}

const horizontalStreak = (seed: number, i: number, frame: number, width: number, height: number): SpeedStreak => {
  const { cycle, progress } = lifecycle(seed, i, frame)
  const at = (k: number): number => randomAt(seed, (cycle * MAX_STREAKS + i) * 6 + k)
  const unit = height / 1080
  // 上下の帯にだけ置く（中央の被写体に掛けない）。
  const band = at(0) < 0.5 ? HORIZONTAL_CLEAR_TOP : 1 - HORIZONTAL_CLEAR_BOTTOM
  const y = at(0) < 0.5 ? height * band * at(1) : height * (HORIZONTAL_CLEAR_BOTTOM + band * at(1))
  const length = width * (0.25 + 0.35 * at(2))
  // 右から左へ、寿命の間に画面を横切る。
  const headX = width * (1.15 - 1.6 * progress) - length * at(4)
  const tailX = headX + length
  const thick = (unit * (2 + 6 * at(3))) / 2
  return {
    // 両端が尖った細い菱形。頭の側を太くする。
    points: [pt(headX, y), pt(headX + length * 0.2, y - thick), pt(tailX, y), pt(headX + length * 0.2, y + thick)].join(' '),
    opacity: lifeOpacity(progress, 0.4 + 0.6 * at(5)),
  }
}

/** 同じコマ・同じ値・同じ種なら同じ筋になる（プレビューと書き出しが同じ絵）。 */
export const speedLines = (params: SpeedLinesParams, frame: number, width: number, height: number, seed: number): readonly SpeedStreak[] => {
  const count = Math.round(MIN_STREAKS + (MAX_STREAKS - MIN_STREAKS) * params.density)
  const streak = params.direction === 'horizontal' ? horizontalStreak : radialStreak
  return Array.from({ length: count }, (_, i) => streak(seed, i, frame, width, height))
}

/** 筋の明るさの形。放射は中心から外へ、横は上下の端ほど明るい。 */
const StreakFill: React.FC<{ readonly id: string; readonly direction: SpeedLinesParams['direction']; readonly width: number; readonly height: number }> = ({
  id,
  direction,
  width,
  height,
}) =>
  direction === 'horizontal' ? (
    <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={0} y2={height}>
      <stop offset="0" stopColor={STREAK_COLOR} stopOpacity={1} />
      <stop offset={HORIZONTAL_CLEAR_TOP} stopColor={STREAK_COLOR} stopOpacity={0.15} />
      <stop offset={HORIZONTAL_CLEAR_BOTTOM} stopColor={STREAK_COLOR} stopOpacity={0.15} />
      <stop offset="1" stopColor={STREAK_COLOR} stopOpacity={1} />
    </linearGradient>
  ) : (
    <radialGradient id={id} gradientUnits="userSpaceOnUse" cx={width / 2} cy={height / 2} r={r4(Math.hypot(width, height) / 2)}>
      <stop offset={RADIAL_CLEAR} stopColor={STREAK_COLOR} stopOpacity={0} />
      <stop offset="0.7" stopColor={STREAK_COLOR} stopOpacity={0.9} />
      <stop offset="1" stopColor={STREAK_COLOR} stopOpacity={1} />
    </radialGradient>
  )

export const SpeedLines: React.FC<OverlayProps<SpeedLinesParams>> = ({ params, time, video, seed, layer }) => {
  const streaks = speedLines(params, time.frame, video.width, video.height, seed)
  const envelope = fadeInOut(time.sec, time.durationSec, 0.15)
  const blur = r4((video.height / 1080) * 1.2)
  // 1 つのページに同じ型が 2 つ出ても定義が混ざらないよう、種で名前を分ける。
  const fillId = `speed-fill-${String(seed)}`
  const blurId = `speed-blur-${String(seed)}`
  return (
    <>
      {/* 周辺減光。`screen` では暗くできないので、筋とは別の層にする。 */}
      <OverlayBox
        name="speed_lines_vignette"
        video={video}
        layer={layer}
        style={{
          opacity: r4(params.intensity * envelope * 0.55),
          backgroundImage: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,0.85) 100%)',
        }}
      />
      <OverlayBox name="speed_lines" video={video} layer={layer} blend="screen" style={{ opacity: r4(params.intensity * envelope) }}>
        <svg width={video.width} height={video.height} viewBox={`0 0 ${String(video.width)} ${String(video.height)}`}>
          <defs>
            <StreakFill id={fillId} direction={params.direction} width={video.width} height={video.height} />
            <filter id={blurId} x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur stdDeviation={blur} />
            </filter>
          </defs>
          <g filter={`url(#${blurId})`} fill={`url(#${fillId})`}>
            {streaks.map((streak, i) => (
              <polygon key={i} points={streak.points} opacity={streak.opacity} />
            ))}
          </g>
        </svg>
      </OverlayBox>
    </>
  )
}
