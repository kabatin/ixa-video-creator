import type { RenderableClip, Resolution, TimelineDocument } from '@ixa/domain'
import type React from 'react'
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  OffthreadVideo,
  Sequence,
  useCurrentFrame,
  useRemotionEnvironment,
} from 'remotion'
import {
  buildTimelinePlan,
  type AudioPlan,
  type ClipPlan,
  type DipPlan,
  type ShotPlan,
} from '../plan.js'
import type { FitRect } from '../presets.js'
import { sourceOffsetFrames } from '../timing.js'
import { ShotVideo } from './shot-video.js'
import { TextClip, resolveTextClip } from './text-clip.js'

export type TimelineCompositionProps = {
  readonly doc: TimelineDocument
  /** 出力キャンバス。null なら `doc.resolution` をそのまま使う。 */
  readonly canvas: Resolution | null
}

type MediaContent = Extract<RenderableClip['content'], { type: 'media' }>

const boxStyle = (video: FitRect): React.CSSProperties => ({
  position: 'absolute',
  left: video.left,
  top: video.top,
  width: video.width,
  height: video.height,
})

const fitStyle = (video: FitRect): React.CSSProperties => ({ ...boxStyle(video), objectFit: 'contain' })

const PLACEHOLDER_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#ffffff',
  fontFamily: 'sans-serif',
  fontSize: 48,
  textAlign: 'center',
  padding: 32,
}

/** 解決できなかったクリップは赤い枠で目立たせる。黒画面のまま悩ませないため。 */
const UNRESOLVED_STYLE: React.CSSProperties = {
  ...PLACEHOLDER_STYLE,
  color: '#ff5555',
  border: '4px solid #ff5555',
  fontSize: 36,
}

/** Shot 本体。`<Sequence>` の中なので `useCurrentFrame()` は Shot 頭からの相対フレーム。 */
const ShotBody: React.FC<{ shot: ShotPlan; video: FitRect }> = ({ shot, video }) => {
  const frame = useCurrentFrame()
  const { isRendering } = useRemotionEnvironment()
  const total = shot.range.durationInFrames
  // ディゾルブは「前の Shot の尻を次の Shot の上に重ねて消す」方式。
  // Shot の開始時刻を一切ずらさずにクロスディゾルブを作れる。
  const opacity =
    shot.fadeOutFrames > 0
      ? interpolate(frame, [total - shot.fadeOutFrames, total], [1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : 1

  return (
    <AbsoluteFill style={{ zIndex: shot.zIndex, opacity }}>
      {/*
        速度は尺に合わせる Shot だけ 1 以外（ADR-0026）。切り出し位置は素材のフレームで数える。
        **Shot の音は鳴らさない**。音楽が先のアプリで、音は曲（AI の動画には音が付いてくることが多い）。
        プレビューは直近のコマを写した下敷きを敷く（ADR-0027）。
      */}
      <ShotVideo shot={shot} box={boxStyle(video)} rendering={isRendering} />
    </AbsoluteFill>
  )
}

const DipBody: React.FC<{ dip: DipPlan }> = ({ dip }) => {
  const frame = useCurrentFrame()
  const total = dip.range.durationInFrames
  const opacity = interpolate(frame, [0, total / 2, total], [0, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  return <AbsoluteFill style={{ backgroundColor: dip.color, opacity, zIndex: dip.zIndex }} />
}

/**
 * 解決済みのメディアクリップ。
 * **`kind` で分岐する。拡張子では判断しない**（署名付き URL には拡張子が付かないことがある）。
 *
 * 自身はフックを持たないので、テストから素の関数として呼んで
 * どの Remotion コンポーネントを選んだかを確認できる。
 */
export const ClipMedia: React.FC<{ content: MediaContent; fps: number; video: FitRect }> = ({
  content,
  fps,
  video,
}) => {
  if (content.kind === 'image') {
    return <Img src={content.mediaUrl} style={fitStyle(video)} />
  }
  if (content.kind === 'audio') {
    return <Audio src={content.mediaUrl} volume={content.volume} />
  }
  return (
    <OffthreadVideo
      src={content.mediaUrl}
      startFrom={sourceOffsetFrames(content.inSec, fps)}
      volume={content.volume}
      style={fitStyle(video)}
    />
  )
}

/**
 * クリップ 1 つ分の描画。
 * テロップとプレースホルダ（`unresolved` / `motion_graphics`）は Remotion のコンテキスト無しでも
 * 描けるので、テストから直接レンダリングして
 * 「文字が絵に出ている」「無言で消えていない」ことを確認できる。
 */
export const ClipBody: React.FC<{ clip: ClipPlan; fps: number; video: FitRect }> = ({
  clip,
  fps,
  video,
}) => {
  const { content } = clip
  const layerStyle = { zIndex: clip.zIndex, opacity: clip.opacity }

  if (content.type === 'media') {
    return (
      <AbsoluteFill style={layerStyle}>
        <ClipMedia content={content} fps={fps} video={video} />
      </AbsoluteFill>
    )
  }

  // 参照先を解決できなかったクリップ。**無言で消さない。**
  // 黒いままだと「素材が無い」のか「配置を間違えた」のかが画から判別できないため、
  // 理由を画面に出して原因調査を絵の中で完結させる。
  if (content.type === 'unresolved') {
    return (
      <AbsoluteFill
        style={{ ...UNRESOLVED_STYLE, ...layerStyle }}
      >{`[unresolved] ${content.reason}`}</AbsoluteFill>
    )
  }

  // テロップ。描けるかどうかの判定は `text-clip.tsx` が domain の表を見て決める。
  // **ここで templateKey を直接分岐しない。**分岐を書くと表と二重化し、
  // 「選べるのに絵に出ない」テンプレートが生まれる。
  if (content.type === 'text') {
    const resolved = resolveTextClip(content)

    if (resolved.status === 'renderable') {
      return (
        <AbsoluteFill style={layerStyle}>
          <TextClip
            template={resolved.template}
            params={resolved.params}
            video={video}
            timing={{ durationInFrames: clip.range.durationInFrames, fps }}
          />
        </AbsoluteFill>
      )
    }

    // 中身が読めないテロップは**壊れている**。unresolved と同じ赤で目立たせる。
    // 空文字に畳んで無言で消すと、文字が無いのか壊れているのかが絵から分からなくなる。
    if (resolved.status === 'invalid') {
      return (
        <AbsoluteFill
          style={{ ...UNRESOLVED_STYLE, ...layerStyle }}
        >{`[text] ${content.templateKey} — ${resolved.reason}`}</AbsoluteFill>
      )
    }

    // まだ絵にできないテンプレート。枠だけ出す。
    return (
      <AbsoluteFill
        style={{ ...PLACEHOLDER_STYLE, ...layerStyle }}
      >{`[text] ${content.templateKey} — ${resolved.reason}`}</AbsoluteFill>
    )
  }

  // motion_graphics のテンプレート機構は今回の範囲外。
  // templateKey が分かるプレースホルダを出すだけにする（これも無言で消さない）。
  return (
    <AbsoluteFill
      style={{ ...PLACEHOLDER_STYLE, ...layerStyle }}
    >{`[${content.type}] ${content.templateKey}`}</AbsoluteFill>
  )
}

const AudioTrack: React.FC<{ track: AudioPlan }> = ({ track }) => (
  <Sequence from={track.range.from} durationInFrames={track.range.durationInFrames} layout="none">
    <Audio src={track.mediaUrl} volume={track.volume} />
  </Sequence>
)

/**
 * プレビューで Shot とクリップを**始まる前から組み立てておく**秒数。
 *
 * Player は `<Sequence>` が始まった瞬間に素材の読み込みを始めるので、以前はカットの境目ごとに
 * 0.1〜0.2 秒黒が挟まった（2026-09-27、モトダチ MV で実測）。1 秒前から組み立てておけば、
 * 境目では頭のコマをもう描ける（Safari の空白は下敷きが埋める / ADR-0027）。
 * Remotion の推奨も 1 秒。
 * 書き出し（renderMedia）では Remotion が premount を使わないので、絵は変わらない。
 * `premountFor` は `layout="none"` と組み合わせられないため、Shot とクリップは既定の layout にする。
 */
const PREMOUNT_SEC = 1

/**
 * **待っている Shot は見える状態のまま、いまの Shot の裏に置く。**
 *
 * Remotion の既定は待っている間 `opacity: 0` で隠す。するとブラウザはその `<video>` のコマを
 * 画面に出さず、見え始めの 1 コマが黒になった（Chrome で画面のコマを全部取って実測。45 秒で 9 か所中 6 回）。
 * コマが出なければ下敷き（`PreviewShotVideo`）にも頭のコマを写せない。後の Shot ほど重なり順が低い
 * （`shotZIndex`）ので、見えていてもいまの Shot に隠れる。
 *
 * **前の Shot と隙間なく続くときだけ。** 隙間があると、黒のはずの間に次の Shot の頭が早く見えてしまう。
 */
const SHOW_BEHIND_WHILE_PREMOUNTED: React.CSSProperties = { opacity: 1 }

/**
 * **切り替わった後も、前の Shot を 1 秒だけ一番下に残す。**
 *
 * 次の Shot の動画が読み込みに間に合わないと、動画も下敷きも空で、1 秒近く黒が出た
 * （WebKit の録画で実測）。前の Shot を重なり順の一番下に残せば、その動画は最後のコマへ頭出しされて
 * 空白になっても、下敷き（`PreviewShotVideo`）に最後のコマが残っている。次の Shot が描かれれば上に来て隠れる。
 * 書き出しは postmount を使わないので絵は変わらない。
 */
const POSTMOUNT_SEC = 1

/** 残しておく前の Shot は、ほかの何よりも下に置く（根に `isolation` を付けて背景の黒よりは上）。 */
const HOLD_UNDER_WHILE_POSTMOUNTED: React.CSSProperties = { opacity: 1, zIndex: -1 }

/** 前の Shot の終わりまでに始まるか（隙間が無いか）。重なり（ディゾルブ）も含む。 */
const followsPrevious = (shots: readonly ShotPlan[], index: number): boolean => {
  const previous = shots[index - 1]
  const current = shots[index]
  if (previous === undefined || current === undefined) return false
  return current.range.from <= previous.range.from + previous.range.durationInFrames
}

/**
 * プレビュー（`@remotion/player`）とレンダリング（`renderMedia`）の共通コンポジション（ADR-0010）。
 *
 * `TimelineDocument` **だけ**を入力に取る。メディアの URL と種別は
 * `packages/timeline` の構築時に解決済みなので、外から辞書を受け取る必要はない。
 */
export const TimelineComposition: React.FC<TimelineCompositionProps> = ({ doc, canvas }) => {
  const plan = buildTimelinePlan(doc, canvas ?? doc.resolution)
  const premountFor = Math.round(PREMOUNT_SEC * plan.fps)
  const postmountFor = Math.round(POSTMOUNT_SEC * plan.fps)

  return (
    // `isolation` で重なりの基準をここに閉じる。zIndex が負の要素を背景の黒より上に描くため。
    <AbsoluteFill style={{ backgroundColor: '#000000', isolation: 'isolate' }}>
      {plan.shots.map((shot, index) => (
        <Sequence
          key={shot.shotId}
          from={shot.range.from}
          durationInFrames={shot.range.durationInFrames}
          premountFor={premountFor}
          styleWhilePremounted={
            followsPrevious(plan.shots, index) ? SHOW_BEHIND_WHILE_PREMOUNTED : undefined
          }
          // 次の Shot が隙間なく続くときだけ残す。最後の Shot や隙間の前では、黒のはずの間に絵を残さない。
          {...(followsPrevious(plan.shots, index + 1)
            ? { postmountFor, styleWhilePostmounted: HOLD_UNDER_WHILE_POSTMOUNTED }
            : {})}
        >
          <ShotBody shot={shot} video={plan.video} />
        </Sequence>
      ))}

      {plan.dips.map((dip) => (
        <Sequence
          key={dip.transitionId}
          from={dip.range.from}
          durationInFrames={dip.range.durationInFrames}
          layout="none"
        >
          <DipBody dip={dip} />
        </Sequence>
      ))}

      {plan.clips.map((clip) => (
        <Sequence
          key={clip.clipId}
          from={clip.range.from}
          durationInFrames={clip.range.durationInFrames}
          premountFor={premountFor}
        >
          <ClipBody clip={clip} fps={plan.fps} video={plan.video} />
        </Sequence>
      ))}

      {plan.audio.map((track, index) => (
        <AudioTrack key={`${String(index)}:${track.mediaUrl}:${track.range.from}`} track={track} />
      ))}
    </AbsoluteFill>
  )
}
