import type React from 'react'
import { useCallback, useRef } from 'react'
import { OffthreadVideo, type OnVideoFrame } from 'remotion'
import type { ShotPlan } from '../plan.js'

/**
 * Shot の動画（ADR-0027）。
 *
 * - 書き出し: `<OffthreadVideo>` だけ。絵は今までと同じ
 * - プレビュー: 同じ `<OffthreadVideo>` の**下に、直近に描いたコマを写した canvas を敷く**
 *
 * Safari（WebKit）は、Shot が切り替わる瞬間やシークの間、動画要素に何も描かない。動画要素は
 * そのとき透けるので、下に何も無ければ背景の黒が見えていた（iPad Pro の Safari で制作者が確認。
 * WebKit の録画で境目に最長 9 コマの黒）。下敷きがあれば、そこには直前のコマ
 * （切り替わりなら、待っている間に写した頭のコマ）が見える。
 *
 * 写すのは Remotion の `onVideoFrame`（動画が画面にコマを出すたびに呼ばれる）。
 * 別オリジンの動画を写した canvas は読み出せなくなるが、表示には差し支えない。
 */
export type ShotVideoProps = {
  readonly shot: Pick<ShotPlan, 'mediaUrl' | 'startFrom' | 'playbackRate'>
  /** 描く枠（位置と大きさ）。contain で収める。 */
  readonly box: React.CSSProperties
  /** 書き出し中か（`useRemotionEnvironment().isRendering`）。 */
  readonly rendering: boolean
}

type BodyProps = Omit<ShotVideoProps, 'rendering'> & { readonly onVideoFrame?: OnVideoFrame }

/**
 * 切り出し位置は素材のフレームで数える。速度は尺に合わせる Shot だけ 1 以外（ADR-0026）。
 * **Shot の音は鳴らさない**。音楽が先のアプリで、音は曲（AI の動画には音が付いてくることが多い）。
 */
const Body = ({ shot, box, onVideoFrame }: BodyProps) => (
  <OffthreadVideo
    src={shot.mediaUrl}
    startFrom={shot.startFrom}
    playbackRate={shot.playbackRate}
    muted
    style={{ ...box, objectFit: 'contain' }}
    {...(onVideoFrame === undefined ? {} : { onVideoFrame })}
  />
)

/**
 * **DOM の型に頼らない。** worker は DOM の型を持たずにこのファイルを型検査するので、
 * `<video>` と `<canvas>` は使う分だけの形で受け、実行時に形を確かめる。
 */
type VideoFrameLike = {
  readonly videoWidth: number
  readonly videoHeight: number
  readonly addEventListener: (type: string, listener: () => void) => void
}
type CanvasLike = {
  width: number
  height: number
  readonly getContext: (contextId: '2d') => {
    readonly drawImage: (image: VideoFrameLike, dx: number, dy: number, dw: number, dh: number) => void
  } | null
}

/** プレビューでは `<video>` 要素が来る。書き出しでは画像が来るが、そこでは写さない。 */
const isVideoFrame = (frame: unknown): frame is VideoFrameLike =>
  typeof frame === 'object' &&
  frame !== null &&
  typeof (frame as { videoWidth?: unknown }).videoWidth === 'number'

const isCanvas = (value: unknown): value is CanvasLike =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { getContext?: unknown }).getContext === 'function'

/**
 * 下敷きへ 1 コマ写す。大きさは素材に合わせる（変わったときだけ。変えると canvas は消える）。
 * **まだコマが無ければ触らない。** 空のコマで上書きすると、下敷きが黒に戻る。
 */
export const copyFrameTo = (canvas: unknown, frame: unknown): void => {
  if (!isCanvas(canvas) || !isVideoFrame(frame)) return
  if (frame.videoWidth === 0 || frame.videoHeight === 0) return
  if (canvas.width !== frame.videoWidth) canvas.width = frame.videoWidth
  if (canvas.height !== frame.videoHeight) canvas.height = frame.videoHeight
  canvas.getContext('2d')?.drawImage(frame, 0, 0, canvas.width, canvas.height)
}

/**
 * `onVideoFrame` だけでは足りない。WebKit は**止まっている動画**（待っている間は頭のコマで止めてある）の
 * コマでは通知を出さないことがあり、頭のコマが写らないまま切り替わって黒が残った（WebKit の録画で実測）。
 * 最初の通知で受け取った動画要素に、読み込み・頭出しの完了でも写すよう付けておく。
 */
const COPY_ON_EVENTS = ['loadeddata', 'seeked', 'canplay'] as const

export const PreviewShotVideo = ({ shot, box }: Omit<ShotVideoProps, 'rendering'>) => {
  const underlay = useRef<HTMLCanvasElement>(null)
  const watched = useRef<VideoFrameLike | null>(null)
  const onVideoFrame = useCallback<OnVideoFrame>((frame) => {
    if (isVideoFrame(frame) && watched.current !== frame) {
      watched.current = frame
      const copy = (): void => {
        copyFrameTo(underlay.current, frame)
      }
      // 要素はこの部品と一緒に消えるので、外さなくても残らない。
      for (const name of COPY_ON_EVENTS) frame.addEventListener(name, copy)
    }
    copyFrameTo(underlay.current, frame)
  }, [])
  return (
    <>
      <canvas ref={underlay} style={{ ...box, objectFit: 'contain' }} />
      <Body shot={shot} box={box} onVideoFrame={onVideoFrame} />
    </>
  )
}

/** 自身はフックを持たないので、テストから素の関数として呼べる。 */
export const ShotVideo = ({ shot, box, rendering }: ShotVideoProps) =>
  rendering ? <Body shot={shot} box={box} /> : <PreviewShotVideo shot={shot} box={box} />
