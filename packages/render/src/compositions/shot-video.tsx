import { Video as MediaVideo } from '@remotion/media'
import type React from 'react'
import { OffthreadVideo } from 'remotion'
import type { ShotPlan } from '../plan.js'

/**
 * Shot の動画（ADR-0027）。**プレビューと書き出しで描き方だけを変える。**
 *
 * - プレビュー: `@remotion/media` の `<Video>`。WebCodecs でコマを canvas に描く。
 *   `<video>` 要素を Shot ごとに切り替える方式では、Safari が切り替わりの頭出しの間に何も描かず、
 *   境目に黒が出た（iPad Pro の Safari で制作者が確認。WebKit の録画で最長 9 コマの黒を実測）。
 * - 書き出し: 今までどおり `<OffthreadVideo>`。絵を変えない（画素のテストもそのまま）。
 *
 * どちらも同じ切り出し位置（素材のフレーム）・速度・消音（ADR-0026）で、同じ枠に contain で収める。
 * 自身はフックを持たないので、テストから素の関数として呼べる。
 */
export type ShotVideoProps = {
  readonly shot: Pick<ShotPlan, 'mediaUrl' | 'startFrom' | 'playbackRate'>
  /** 描く枠（contain の指定は含めない。部品ごとに付け方が違う）。 */
  readonly box: React.CSSProperties
  /** 書き出し中か（`useRemotionEnvironment().isRendering`）。 */
  readonly rendering: boolean
}

export const ShotVideo = ({ shot, box, rendering }: ShotVideoProps) =>
  rendering ? (
    <OffthreadVideo
      src={shot.mediaUrl}
      startFrom={shot.startFrom}
      playbackRate={shot.playbackRate}
      muted
      style={{ ...box, objectFit: 'contain' }}
    />
  ) : (
    <MediaVideo
      src={shot.mediaUrl}
      trimBefore={shot.startFrom}
      playbackRate={shot.playbackRate}
      muted
      objectFit="contain"
      style={box}
    />
  )
