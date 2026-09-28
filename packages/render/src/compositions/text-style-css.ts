import type { TextAnchor, TextFont, TextShadow, TextWeight } from '@ixa/domain'
import type React from 'react'
import type { FitRect } from '../presets.js'

/**
 * テロップの見た目（`ResolvedTextStyle`）を CSS へ写す表（ADR-0028）。
 *
 * 書体は**端末に入っている和文書体のまとまり**で持つ。外部フォントを読むと、レンダリング環境ごとに
 * 出たり出なかったりするため読まない。どの並びも最後は総称（sans-serif / serif）に落ちる。
 * プレビューは閲覧者の端末、書き出しは worker の Chromium のフォントで描かれる。
 */
export const FONT_STACKS: Readonly<Record<TextFont, string>> = Object.freeze({
  gothic: "'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', 'Yu Gothic', 'Meiryo', sans-serif",
  mincho: "'Hiragino Mincho ProN', 'Noto Serif JP', 'Yu Mincho', serif",
  // 丸ゴシックが無い端末（Windows など）ではゴシックになる。
  rounded: "'Hiragino Maru Gothic ProN', 'Zen Maru Gothic', 'Hiragino Sans', 'Noto Sans JP', sans-serif",
})

export const FONT_WEIGHTS: Readonly<Record<TextWeight, number>> = Object.freeze({
  regular: 400,
  bold: 700,
  heavy: 900,
})

/** 映像の上に載るので、背景が明るくても読めるように影を敷く。`soft` が今までの影。 */
export const TEXT_SHADOWS: Readonly<Record<TextShadow, string | undefined>> = Object.freeze({
  none: undefined,
  soft: '0 2px 12px rgba(0, 0, 0, 0.85)',
  strong: '0 0 4px rgba(0, 0, 0, 1), 0 3px 18px rgba(0, 0, 0, 0.95)',
})

/** `#RRGGBB` と濃さから `rgba(...)`。 */
export const rgba = (hex: string, opacity: number): string => {
  const value = Number.parseInt(hex.slice(1), 16)
  return `rgba(${String((value >> 16) & 255)}, ${String((value >> 8) & 255)}, ${String(value & 255)}, ${String(opacity)})`
}

const VERTICAL = { top: 'flex-start', middle: 'center', bottom: 'flex-end' } as const
const HORIZONTAL = { left: 'flex-start', center: 'center', right: 'flex-end' } as const

/** 上下の端からの余白（映像の高さに対する割合）。今までの下帯と同じ。 */
const EDGE_MARGIN_Y = 0.08
/** 左右の端からの余白（映像の幅に対する割合）。 */
const EDGE_MARGIN_X = 0.05

const splitAnchor = (anchor: TextAnchor) => {
  const [vertical, horizontal] = anchor.split('-') as [keyof typeof VERTICAL, keyof typeof HORIZONTAL]
  return { vertical, horizontal }
}

/** 映像の枠（flex の入れ物）の中で、9 か所のどこへ寄せるか。 */
export const anchorBoxStyle = (anchor: TextAnchor): React.CSSProperties => {
  const { vertical, horizontal } = splitAnchor(anchor)
  return { alignItems: VERTICAL[vertical], justifyContent: HORIZONTAL[horizontal] }
}

/** 端に寄せたときだけ余白を取る。中央では取らない。 */
export const anchorMargins = (anchor: TextAnchor, video: FitRect): React.CSSProperties => {
  const { vertical, horizontal } = splitAnchor(anchor)
  const y = video.height * EDGE_MARGIN_Y
  const x = video.width * EDGE_MARGIN_X
  return {
    ...(vertical === 'top' ? { marginTop: y } : {}),
    ...(vertical === 'bottom' ? { marginBottom: y } : {}),
    ...(horizontal === 'left' ? { marginLeft: x } : {}),
    ...(horizontal === 'right' ? { marginRight: x } : {}),
  }
}
