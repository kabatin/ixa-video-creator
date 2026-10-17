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
  impact: { font: FONT_STACKS.gothic, weight: 900, size: 0.15, letterSpacingEm: 0.02, shadow: '0 6px 28px rgba(0, 0, 0, 0.85)' },
  elegant: { font: FONT_STACKS.mincho, weight: 400, size: 0.1, letterSpacingEm: 0.3, shadow: '0 2px 16px rgba(0, 0, 0, 0.7)' },
} as const

/** 文字を置ける幅（映像の幅に対する割合）。両端に余白を残す。 */
export const TITLE_SAFE_WIDTH = 0.88

/**
 * 1 文字の幅の見積もり（em）。全角（かな・漢字・全角記号）は 1、半角は太字の大文字を見込んで 0.72。
 * 書体を測らずに決める（プレビューと書き出しで端末の書体が違っても、同じ大きさになる）。
 */
const charWidthEm = (char: string): number => ((char.codePointAt(0) ?? 0) >= 0x2e80 ? 1 : 0.72)

/** 1 行の幅の見積もり（em）。字間は最後の字の後ろにも付く。 */
export const titleWidthEm = (text: string, letterSpacingEm: number): number =>
  [...text].reduce((sum, char) => sum + charWidthEm(char) + letterSpacingEm, 0)

/**
 * タイトルの文字の大きさ（px）。型の大きさ（映像の高さに対する割合）を上限に、
 * **見積もった幅が置ける幅に収まるまで小さくする。** 40 字の上限まで 1 行で切れずに収まる。
 */
export const titleCardFontSize = (params: TitleCardParams, video: { readonly width: number; readonly height: number }): number => {
  const look = LOOKS[params.style]
  const byHeight = video.height * look.size
  const byWidth = (video.width * TITLE_SAFE_WIDTH) / Math.max(1, titleWidthEm(params.text, look.letterSpacingEm))
  return Math.max(1, Math.floor(Math.min(byHeight, byWidth)))
}

const SUBTEXT_SPACING_EM = 0.2

/** 添える文字の大きさ（px）。タイトルの 32% を上限に、同じく置ける幅に収める。 */
export const titleCardSubtextSize = (subtext: string, titleSize: number, videoWidth: number): number =>
  Math.max(1, Math.floor(Math.min(titleSize * 0.32, (videoWidth * TITLE_SAFE_WIDTH) / Math.max(1, titleWidthEm(subtext, SUBTEXT_SPACING_EM)))))

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
export const TitleCard: React.FC<OverlayProps<TitleCardParams>> = ({ params, time, video, layer }) => {
  const look = LOOKS[params.style]
  const motion = titleCardMotion(params, time.sec, time.durationSec)
  const fontSize = titleCardFontSize(params, video)
  return (
    <OverlayBox
      name="title_card"
      video={video}
      layer={layer}
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
          letterSpacing: `${String(look.letterSpacingEm)}em`,
          lineHeight: 1.1,
          textAlign: 'center',
          textShadow: look.shadow,
          whiteSpace: 'nowrap',
          maxWidth: video.width * TITLE_SAFE_WIDTH,
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
            fontSize: titleCardSubtextSize(params.subtext, fontSize, video.width),
            letterSpacing: `${String(SUBTEXT_SPACING_EM)}em`,
            whiteSpace: 'nowrap',
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
