import {
  MAX_TEXT_CLIP_LENGTH,
  TextTemplateKey,
  isPlaceholderTextTemplate,
  parseTextClipParams,
  resolveTextStyle,
  type ResolvedTextStyle,
  type TextClipParams,
} from '@ixa/domain'
import type React from 'react'
import { useCurrentFrame } from 'remotion'
import type { FitRect } from '../presets.js'
import {
  FONT_STACKS,
  FONT_WEIGHTS,
  TEXT_SHADOWS,
  anchorBoxStyle,
  anchorMargins,
  rgba,
} from './text-style-css.js'

/**
 * テロップの描画。
 *
 * **テンプレートの正は `@ixa/domain` の `TEXT_TEMPLATE_SUPPORT` だけが持つ。**
 * ここはその表に載っているキーへ「描き方」を対応させるだけで、
 * 自前のキー一覧を持たない。画面・検証・レンダラが同じ表を見ないと、
 * **選べるのに絵に出ない**テンプレートが生まれる（`wipe` がそうだった）。
 *
 * 中身のスキーマも書き写さず、`parseTextClipParams` を通す（lessons L-016）。
 */

/** 行間。文字の大きさから帯の高さを逆算するのにも使う。 */
const LINE_HEIGHT = 1.3

/** テンプレートごとの文字の置き場所。文字の大きさはここから逆算する。 */
export type TextLayout = {
  /** 文字を流し込める幅（映像の幅に対する割合）。 */
  readonly widthRatio: number
  /** 折り返して何行まで許すか。 */
  readonly maxLines: number
  /** 文字の最大の大きさ（映像の高さに対する割合）。 */
  readonly maxSizeRatio: number
}

/**
 * 型だけが持つ飾り。見た目（色・位置など）は domain の既定値（`TEXT_TEMPLATE_STYLE_DEFAULTS`）が持ち、
 * ここは「帯を幅いっぱいに敷くか」「左に線を引くか」だけ（ADR-0028）。
 */
type TemplateDecor = {
  /** 帯の幅。full = 流し込み幅いっぱい、fit = 文字に合わせる。 */
  readonly width: 'full' | 'fit'
  readonly leftBar: boolean
}

type DrawProps = {
  readonly text: string
  readonly video: FitRect
  readonly layout: TextLayout
  readonly decor: TemplateDecor
  readonly style: ResolvedTextStyle
  readonly fontSize: number
  readonly template: TextTemplateKey
}

/** 映像の矩形に重ねる箱。レターボックスの黒帯に文字がはみ出さないようにする。 */
const videoBoxStyle = (video: FitRect): React.CSSProperties => ({
  position: 'absolute',
  left: video.left,
  top: video.top,
  width: video.width,
  height: video.height,
  display: 'flex',
  overflow: 'hidden',
})

const bodyStyle = (style: ResolvedTextStyle, fontSize: number): React.CSSProperties => {
  const shadow = TEXT_SHADOWS[style.shadow]
  return {
    fontFamily: FONT_STACKS[style.font],
    fontSize,
    lineHeight: LINE_HEIGHT,
    color: style.color,
    fontWeight: FONT_WEIGHTS[style.weight],
    textAlign: style.align,
    ...(shadow === undefined ? {} : { textShadow: shadow }),
    // 縁取りは線の半分が文字の内側に食い込むので、塗りを後から重ねて外側だけ残す。
    ...(style.stroke === null
      ? {}
      : {
          WebkitTextStroke: `${String(Math.round(fontSize * style.stroke.width))}px ${style.stroke.color}`,
          paintOrder: 'stroke fill',
        }),
    // 日本語は単語の境目が無いので、どこでも折り返せるようにしておく。
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
  }
}

/** 文字の入れ物（帯）。背景・左の線・幅・ずらしを持つ。 */
const bandStyle = ({ video, layout, decor, style, fontSize }: DrawProps): React.CSSProperties => {
  const { x, y } = style.offset
  return {
    ...(decor.width === 'full'
      ? { width: `${String(layout.widthRatio * 100)}%` }
      : { maxWidth: `${String(layout.widthRatio * 100)}%` }),
    ...anchorMargins(style.anchor, video),
    ...(style.background === null
      ? {}
      : {
          padding: `${String(fontSize * 0.5)}px ${String(fontSize * 0.75)}px`,
          backgroundColor: rgba(style.background.color, style.background.opacity),
        }),
    // 左の線は帯の飾り。帯を消したら線も引かない（線だけ残ると浮く）。
    ...(decor.leftBar && style.background !== null
      ? { borderLeft: `${String(Math.max(2, Math.round(fontSize * 0.12)))}px solid #ffffff` }
      : {}),
    ...(x === 0 && y === 0
      ? {}
      : { transform: `translate(${String(x * video.width)}px, ${String(y * video.height)}px)` }),
  }
}

/** 型の既定値に見た目を重ねた 1 つの描き方。 */
const StyledText: React.FC<DrawProps> = (props) => (
  <div
    data-text-template={props.template}
    style={{ ...videoBoxStyle(props.video), ...anchorBoxStyle(props.style.anchor) }}
  >
    <div style={bandStyle(props)}>
      <div style={bodyStyle(props.style, props.fontSize)}>{props.text}</div>
    </div>
  </div>
)

/**
 * テンプレートの登録簿。**キーは `TextTemplateKey` の全域**なので、
 * domain にキーを足して描き方を足し忘れたら型検査で落ちる。
 */
const TEXT_TEMPLATES: Readonly<
  Record<TextTemplateKey, { readonly layout: TextLayout; readonly decor: TemplateDecor }>
> = Object.freeze({
  plain: {
    layout: { widthRatio: 0.8, maxLines: 3, maxSizeRatio: 0.12 },
    decor: { width: 'fit', leftBar: false },
  },
  lower_third: {
    layout: { widthRatio: 0.9, maxLines: 2, maxSizeRatio: 0.07 },
    decor: { width: 'full', leftBar: true },
  },
})

const hasDrawer = (template: TextTemplateKey): boolean =>
  Object.prototype.hasOwnProperty.call(TEXT_TEMPLATES, template)

/**
 * 文字が枠に収まる大きさを求める。
 *
 * 全角 1 文字をおよそ 1em として数えると、幅 W の箱に `maxLines` 行で入る字数は
 * `W * maxLines / size`。これを文字数と等しく置いた `size` が「ちょうど埋まる」大きさで、
 * これ以上大きくしなければはみ出さない。短い文字は読みやすさのため上限で頭打ちにする。
 *
 * 文字数の上限（`MAX_TEXT_CLIP_LENGTH`）は domain が持つ。ここは
 * **その上限の長さでも収まること**を保証するだけで、上限そのものを持たない。
 */
export const textClipFontSize = (
  template: TextTemplateKey,
  text: string,
  video: FitRect,
): number => {
  const { layout } = TEXT_TEMPLATES[template]
  const boxWidth = video.width * layout.widthRatio
  const charCount = Math.max(text.length, 1)
  const fits = Math.floor((boxWidth * layout.maxLines) / charCount)
  return Math.max(1, Math.min(Math.floor(video.height * layout.maxSizeRatio), fits))
}

/** テンプレートの置き場所。テストが実際の寸法から収まるかを計算するのに使う。 */
export const textClipLayout = (template: TextTemplateKey): TextLayout =>
  TEXT_TEMPLATES[template].layout

/** `maxLines` 行すべてを使ったときの文字の高さ。枠に収まるかの検証に使う。 */
export const textClipBlockHeight = (template: TextTemplateKey, fontSize: number): number =>
  TEXT_TEMPLATES[template].layout.maxLines * fontSize * LINE_HEIGHT

/**
 * テロップを描けるかどうかの判定。
 *
 * **読めない `params` を空文字に畳まない。** 畳むと「文字が無いテロップ」と
 * 「壊れたテロップ」が同じ見た目になり、絵から区別できなくなる（lessons L-015）。
 */
export type TextClipResolution =
  | {
      readonly status: 'renderable'
      readonly template: TextTemplateKey
      readonly params: TextClipParams
    }
  /** テンプレートをまだ絵にできない。枠だけ出す。 */
  | { readonly status: 'placeholder'; readonly reason: string }
  /** テンプレートは描けるが、中身が読めない。壊れていることを絵に出す。 */
  | { readonly status: 'invalid'; readonly reason: string }

export const resolveTextClip = (content: {
  readonly templateKey: string
  readonly params: unknown
}): TextClipResolution => {
  const parsedKey = TextTemplateKey.safeParse(content.templateKey)
  if (!parsedKey.success) {
    // 移行前の `lower-third` のような古い名前がここに来る。
    // **候補を絵に出す。** 「テンプレート名を直せば済む」と分かるようにするため。
    // 一覧は登録簿から作る（手で書くと登録簿とズレる）。
    return {
      status: 'placeholder',
      reason: `知らないテンプレートです（使えるのは ${TextTemplateKey.options.join(' / ')}）`,
    }
  }

  const template = parsedKey.data
  if (isPlaceholderTextTemplate(template)) {
    return { status: 'placeholder', reason: 'まだ絵にできないテンプレートです' }
  }
  // 実装済みと書かれているのに描き方が無い状態。型検査で防いでいるが、
  // 表だけ更新されたときに無言で何も描かないことがないよう実行時にも見る。
  if (!hasDrawer(template)) {
    return { status: 'placeholder', reason: '描き方が登録されていません' }
  }

  const params = parseTextClipParams(content.params)
  if (params === null) {
    return {
      status: 'invalid',
      reason: `テロップの中身を読めません（${MAX_TEXT_CLIP_LENGTH} 文字以内の空でない文字列）`,
    }
  }

  return { status: 'renderable', template, params }
}

/**
 * フェードの濃さ（ADR-0028）。頭から `fadeInSec` で 0 → 1、終わりへ `fadeOutSec` で 1 → 0。
 * それぞれ尺の半分より長くはしない（両方が重なって最後まで薄いままにならないよう）。
 */
export const textFadeOpacity = ({
  frame,
  durationInFrames,
  fps,
  fadeInSec,
  fadeOutSec,
}: {
  readonly frame: number
  readonly durationInFrames: number
  readonly fps: number
  readonly fadeInSec: number
  readonly fadeOutSec: number
}): number => {
  const half = durationInFrames / 2
  const inFrames = Math.min(fadeInSec * fps, half)
  const outFrames = Math.min(fadeOutSec * fps, half)
  const clamp = (value: number): number => Math.min(1, Math.max(0, value))
  const fadeIn = inFrames > 0 ? clamp(frame / inFrames) : 1
  const fadeOut = outFrames > 0 ? clamp((durationInFrames - frame) / outFrames) : 1
  return Math.min(fadeIn, fadeOut)
}

/** クリップの尺。フェードの計算に使う。 */
export type TextClipTiming = { readonly durationInFrames: number; readonly fps: number }

/** フェードがあるときだけ使う。**フックを持つ**ので、フェードの無いテロップはこれを通さない。 */
const Fade: React.FC<{
  readonly timing: TextClipTiming
  readonly style: ResolvedTextStyle
  readonly children: React.ReactNode
}> = ({ timing, style, children }) => {
  const frame = useCurrentFrame()
  const opacity = textFadeOpacity({ frame, ...timing, fadeInSec: style.fadeInSec, fadeOutSec: style.fadeOutSec })
  return <div style={{ position: 'absolute', inset: 0, opacity }}>{children}</div>
}

/**
 * 解決済みのテロップ本体。`resolveTextClip` が `renderable` を返したときだけ呼ぶ。
 * フェードが無ければフックを持たないので、テストから素の関数としても呼べる。
 */
export const TextClip: React.FC<{
  readonly template: TextTemplateKey
  readonly params: TextClipParams
  readonly video: FitRect
  /** 無ければフェードしない（静的な確認用）。 */
  readonly timing?: TextClipTiming
}> = ({ template, params, video, timing }) => {
  const { layout, decor } = TEXT_TEMPLATES[template]
  const style = resolveTextStyle(template, params.style)
  const fontSize =
    style.size === null
      ? textClipFontSize(template, params.text, video)
      : Math.max(1, Math.round(style.size * video.height))
  const body = (
    <StyledText
      text={params.text}
      video={video}
      layout={layout}
      decor={decor}
      style={style}
      fontSize={fontSize}
      template={template}
    />
  )
  const fades = style.fadeInSec > 0 || style.fadeOutSec > 0
  return fades && timing !== undefined ? (
    <Fade timing={timing} style={style}>
      {body}
    </Fade>
  ) : (
    body
  )
}
