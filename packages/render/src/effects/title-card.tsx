import type { TitleCardParams } from '@ixa/domain'
import type React from 'react'
import { FONT_STACKS } from '../compositions/text-style-css.js'
import { clamp01, easeOutCubic } from './envelope.js'
import { OverlayBox, r4, type OverlayProps } from './overlay-box.js'

/** 入り（秒）。叩きつけは速く、ふわっとはゆっくり。 */
const ENTRANCE_SEC = { punch: 0.18, fade: 0.45 } as const
/** 終わりに消える長さ（秒）。 */
const EXIT_SEC = 0.25

const LOOKS = {
  impact: { font: FONT_STACKS.gothic, weight: 900, size: 0.15, letterSpacing: '0.02em', shadow: '0 6px 28px rgba(0, 0, 0, 0.85)' },
  elegant: { font: FONT_STACKS.mincho, weight: 400, size: 0.1, letterSpacing: '0.3em', shadow: '0 2px 16px rgba(0, 0, 0, 0.7)' },
} as const

export type TitleCardMotion = { readonly opacity: number; readonly scale: number; readonly offsetY: number }

/**
 * タイトルの出方。`punch` は大きく出て一気に縮んで止まる。`fade` は少し下からふわっと上がる。
 * 終わりの `EXIT_SEC` で消える。
 */
export const titleCardMotion = (params: TitleCardParams, sec: number, durationSec: number): TitleCardMotion => {
  const enter = easeOutCubic(sec / ENTRANCE_SEC[params.entrance])
  const exit = clamp01((durationSec - sec) / EXIT_SEC)
  if (params.entrance === 'punch') {
    return { opacity: r4(clamp01(enter * 2) * exit), scale: r4(1.6 - 0.6 * enter), offsetY: 0 }
  }
  return { opacity: r4(enter * exit), scale: 1, offsetY: r4(0.04 * (1 - enter)) }
}

/** タイトルカード。映像の真ん中に大きな文字を出し、下に添える文字を小さく出す。 */
export const TitleCard: React.FC<OverlayProps<TitleCardParams>> = ({ params, time, video }) => {
  const look = LOOKS[params.style]
  const motion = titleCardMotion(params, time.sec, time.durationSec)
  const fontSize = Math.round(video.height * look.size)
  return (
    <OverlayBox
      name="title_card"
      video={video}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: motion.opacity,
        transform: `translateY(${String(r4(motion.offsetY * video.height))}px) scale(${String(motion.scale)})`,
      }}
    >
      <div
        style={{
          color: params.color,
          fontFamily: look.font,
          fontWeight: look.weight,
          fontSize,
          letterSpacing: look.letterSpacing,
          lineHeight: 1.1,
          textAlign: 'center',
          textShadow: look.shadow,
          whiteSpace: 'nowrap',
          maxWidth: video.width * 0.92,
        }}
      >
        {params.text}
      </div>
      {params.subtext === '' ? null : (
        <div
          style={{
            color: params.color,
            fontFamily: look.font,
            fontWeight: Math.min(700, look.weight),
            fontSize: Math.round(fontSize * 0.32),
            letterSpacing: '0.2em',
            marginTop: Math.round(fontSize * 0.2),
            textShadow: look.shadow,
            textAlign: 'center',
          }}
        >
          {params.subtext}
        </div>
      )}
    </OverlayBox>
  )
}
