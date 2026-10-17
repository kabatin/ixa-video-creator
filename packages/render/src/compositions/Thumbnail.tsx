import { THUMBNAIL_SIZE, type ThumbnailSpec } from '@ixa/domain'
import type React from 'react'
import { AbsoluteFill, Freeze, Img } from 'remotion'
import { TimelineComposition } from './Timeline.js'
import { FONT_STACKS, TEXT_SHADOWS, rgba } from './text-style-css.js'
import {
  SUBTITLE_LINE_HEIGHT,
  TEXT_BLOCKS,
  TITLE_LINE_HEIGHT,
  coverBox,
  fitThumbnailText,
  textGap,
  thumbnailFrameOf,
  zoomTransform,
  type Focus,
} from './thumbnail-layout.js'
import type { FittedText } from './thumbnail-text-fit.js'
import type { ThumbnailBackgroundSource, ThumbnailCompositionProps } from './thumbnail-props.js'

/**
 * YouTube のサムネイル（ADR-0051）。1280×720 の 1 枚。
 *
 * **画面の Player と worker の renderStill が同じこのコンポジションを描く**（ADR-0010 と同じ考え）。
 * タイムラインのコマは `TimelineComposition` を書き写さずにそのまま使い、`<Freeze>` でそのコマに止める。
 * 書体は端末の和文書体（テロップと同じ `FONT_STACKS`）。外部フォントは読まない。
 */

/** 背景の種類と材料が食い違ったときの赤い表示。黒い画面のまま悩ませない（Timeline の未解決と同じ扱い）。 */
const MISMATCH_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#ff5555',
  border: '8px solid #ff5555',
  fontFamily: FONT_STACKS.gothic,
  fontSize: 40,
}

const focusOf = (spec: ThumbnailSpec): Focus => ({ x: spec.focusX, y: spec.focusY })

/** タイムラインのコマ。作品の解像度の比のまま覆う大きさで描き、その枠をキャンバスに置く。 */
const TimelineFrame: React.FC<{
  readonly doc: Extract<ThumbnailBackgroundSource, { kind: 'timeline_frame' }>['doc']
  readonly atSec: number
  readonly focus: Focus
}> = ({ doc, atSec, focus }) => {
  const box = coverBox(doc.resolution, THUMBNAIL_SIZE, focus)
  const canvas = { width: box.width, height: box.height }
  return (
    <div style={{ position: 'absolute', left: box.left, top: box.top, width: box.width, height: box.height }}>
      <Freeze frame={thumbnailFrameOf(atSec, doc)}>
        <TimelineComposition doc={doc} canvas={canvas} />
      </Freeze>
    </div>
  )
}

/** 素材の画像。大きさを知らなくてよいよう CSS の cover で覆う（`coverBox` と同じ寄せ方）。 */
const ImageFrame: React.FC<{ readonly url: string; readonly focus: Focus }> = ({ url, focus }) => (
  <Img
    src={url}
    style={{
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      objectPosition: `${String(focus.x * 100)}% ${String(focus.y * 100)}%`,
    }}
  />
)

const Background: React.FC<ThumbnailCompositionProps> = ({ spec, source }) => {
  const focus = focusOf(spec)
  if (spec.background.kind === 'timeline_frame' && source.kind === 'timeline_frame') {
    return <TimelineFrame doc={source.doc} atSec={spec.background.atSec} focus={focus} />
  }
  if (spec.background.kind === 'image' && source.kind === 'image') {
    return <ImageFrame url={source.url} focus={focus} />
  }
  return <AbsoluteFill style={MISMATCH_STYLE}>背景の材料が仕様と合っていません</AbsoluteFill>
}

/** 文字の下に敷く暗がり。明るい背景でも題名が読めるようにする（配置ごとに文字の側だけ暗くする）。 */
const SCRIMS: Readonly<Record<ThumbnailSpec['layout'], string>> = Object.freeze({
  left: 'linear-gradient(to right, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.38) 34%, rgba(0,0,0,0) 56%)',
  center: 'radial-gradient(ellipse at center, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.15) 70%, rgba(0,0,0,0) 100%)',
  bottom: 'linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.5) 30%, rgba(0,0,0,0) 48%)',
})

const titleStyle = (spec: ThumbnailSpec, size: number): React.CSSProperties => ({
  fontFamily: FONT_STACKS[spec.font],
  fontSize: size,
  fontWeight: 900,
  lineHeight: TITLE_LINE_HEIGHT,
  color: spec.titleColor,
  // 縁取りは線の半分が内側に食い込むので、塗りを後から重ねて外側だけ残す（テロップと同じ）。
  WebkitTextStroke: `${String(Math.max(4, Math.round(size * 0.08)))}px #000000`,
  paintOrder: 'stroke fill',
  textShadow: TEXT_SHADOWS.strong,
  margin: 0,
})

const subtitleStyle = (spec: ThumbnailSpec, size: number): React.CSSProperties => ({
  fontFamily: FONT_STACKS[spec.font],
  fontSize: size,
  fontWeight: 700,
  lineHeight: SUBTITLE_LINE_HEIGHT,
  color: '#ffffff',
  textShadow: TEXT_SHADOWS.strong,
  margin: 0,
})

/**
 * 行は `fitThumbnailText` が決めたもの。**ここでは折り返さない**（1 行ずつ nowrap で描く）。
 * ブラウザに折り返させると、画面と書き出しで切れ目が変わり、英単語の途中でも切れる。
 */
const Lines: React.FC<{ readonly fitted: FittedText; readonly style: React.CSSProperties }> = ({ fitted, style }) => (
  <p style={style}>
    {fitted.lines.map((line, index) => (
      <span key={`${String(index)}:${line}`} style={{ display: 'block', whiteSpace: 'nowrap' }}>
        {line}
      </span>
    ))}
  </p>
)

/** 差し色の帯。left・center は題名の上の短い線、bottom は帯の上端いっぱい。 */
const AccentBar: React.FC<{ readonly spec: ThumbnailSpec; readonly titleSize: number }> = ({ spec, titleSize }) => {
  const thickness = Math.max(10, Math.round(titleSize * 0.1))
  if (spec.layout === 'bottom') return null
  return (
    <div
      style={{
        width: Math.round(titleSize * 1.6),
        height: thickness,
        backgroundColor: spec.accentColor,
        boxShadow: `0 2px 10px ${rgba('#000000', 0.6)}`,
        alignSelf: spec.layout === 'center' ? 'center' : 'flex-start',
      }}
    />
  )
}

const TextLayer: React.FC<{ readonly spec: ThumbnailSpec }> = ({ spec }) => {
  const block = TEXT_BLOCKS[spec.layout]
  const fitted = fitThumbnailText(spec)
  const titleSize = fitted.title.size
  return (
    <AbsoluteFill style={{ backgroundImage: SCRIMS[spec.layout] }}>
      {spec.layout === 'bottom' && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: block.top - 24,
            height: Math.max(10, Math.round(titleSize * 0.1)),
            backgroundColor: spec.accentColor,
          }}
        />
      )}
      <div
        style={{
          position: 'absolute',
          left: block.left,
          top: block.top,
          width: block.width,
          height: block.height,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: block.vertical === 'center' ? 'center' : 'flex-end',
          textAlign: block.align,
          gap: textGap(titleSize),
        }}
      >
        <AccentBar spec={spec} titleSize={titleSize} />
        <Lines fitted={fitted.title} style={titleStyle(spec, titleSize)} />
        {fitted.subtitle !== null && <Lines fitted={fitted.subtitle} style={subtitleStyle(spec, fitted.subtitle.size)} />}
      </div>
    </AbsoluteFill>
  )
}

export const ThumbnailComposition: React.FC<ThumbnailCompositionProps> = (props) => {
  const { zoom } = props.spec
  return (
    <AbsoluteFill style={{ backgroundColor: '#000000', overflow: 'hidden' }}>
      <AbsoluteFill style={zoomTransform(zoom, focusOf(props.spec))}>
        <Background {...props} />
      </AbsoluteFill>
      <TextLayer spec={props.spec} />
    </AbsoluteFill>
  )
}
