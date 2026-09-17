import {
  MAX_TEXT_CLIP_LENGTH,
  TextTemplateKey,
  isPlaceholderTextTemplate,
  parseTextClipParams,
  type TextClipParams,
} from '@ixa/domain'
import type React from 'react'
import type { FitRect } from '../presets.js'

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

/** 映像の上に載るので、背景が明るくても読めるように影を敷く。 */
const TEXT_SHADOW = '0 2px 12px rgba(0, 0, 0, 0.85)'

/**
 * Remotion（ヘッドレス Chromium）の既定で出るフォントだけを指定する。
 * 外部フォントを読み込むと、レンダリング環境ごとに出たり出なかったりするため。
 * 日本語は最終的に `sans-serif` のシステムフォールバックで描かれる。
 */
const FONT_FAMILY = "'Hiragino Sans', 'Noto Sans JP', 'Yu Gothic', sans-serif"

/** テンプレートごとの文字の置き場所。文字の大きさはここから逆算する。 */
export type TextLayout = {
  /** 文字を流し込める幅（映像の幅に対する割合）。 */
  readonly widthRatio: number
  /** 折り返して何行まで許すか。 */
  readonly maxLines: number
  /** 文字の最大の大きさ（映像の高さに対する割合）。 */
  readonly maxSizeRatio: number
}

type DrawProps = {
  readonly text: string
  readonly video: FitRect
  readonly layout: TextLayout
  readonly fontSize: number
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

const bodyStyle = (fontSize: number): React.CSSProperties => ({
  fontFamily: FONT_FAMILY,
  fontSize,
  lineHeight: LINE_HEIGHT,
  color: '#ffffff',
  fontWeight: 700,
  // 日本語は単語の境目が無いので、どこでも折り返せるようにしておく。
  overflowWrap: 'anywhere',
  whiteSpace: 'pre-wrap',
})

/** 画面の中央に文字を置くだけ。飾りは無い。 */
const PlainText: React.FC<DrawProps> = ({ text, video, layout, fontSize }) => (
  <div
    data-text-template="plain"
    style={{ ...videoBoxStyle(video), alignItems: 'center', justifyContent: 'center' }}
  >
    <div
      style={{
        ...bodyStyle(fontSize),
        maxWidth: `${layout.widthRatio * 100}%`,
        textAlign: 'center',
        textShadow: TEXT_SHADOW,
      }}
    >
      {text}
    </div>
  </div>
)

/** 下寄せの帯に載せる。よくある字幕の形。 */
const LowerThird: React.FC<DrawProps> = ({ text, video, layout, fontSize }) => (
  <div
    data-text-template="lower_third"
    style={{ ...videoBoxStyle(video), alignItems: 'flex-end', justifyContent: 'center' }}
  >
    <div
      style={{
        width: `${layout.widthRatio * 100}%`,
        marginBottom: video.height * 0.08,
        padding: `${fontSize * 0.5}px ${fontSize * 0.75}px`,
        backgroundColor: 'rgba(0, 0, 0, 0.55)',
        borderLeft: `${Math.max(2, Math.round(fontSize * 0.12))}px solid #ffffff`,
      }}
    >
      <div style={{ ...bodyStyle(fontSize), textAlign: 'left' }}>{text}</div>
    </div>
  </div>
)

/**
 * テンプレートの登録簿。**キーは `TextTemplateKey` の全域**なので、
 * domain にキーを足して描き方を足し忘れたら型検査で落ちる。
 */
const TEXT_TEMPLATES: Readonly<
  Record<TextTemplateKey, { readonly layout: TextLayout; readonly Draw: React.FC<DrawProps> }>
> = Object.freeze({
  plain: {
    layout: { widthRatio: 0.8, maxLines: 3, maxSizeRatio: 0.12 },
    Draw: PlainText,
  },
  lower_third: {
    layout: { widthRatio: 0.9, maxLines: 2, maxSizeRatio: 0.07 },
    Draw: LowerThird,
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
 * 解決済みのテロップ本体。`resolveTextClip` が `renderable` を返したときだけ呼ぶ。
 * 自身はフックを持たないので、テストから素の関数としても呼べる。
 */
export const TextClip: React.FC<{
  readonly template: TextTemplateKey
  readonly params: TextClipParams
  readonly video: FitRect
}> = ({ template, params, video }) => {
  const { layout, Draw } = TEXT_TEMPLATES[template]
  return (
    <Draw
      text={params.text}
      video={video}
      layout={layout}
      fontSize={textClipFontSize(template, params.text, video)}
    />
  )
}
