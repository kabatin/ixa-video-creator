'use client'

import { ThumbnailComposition, thumbnailMetadata, type ThumbnailCompositionProps } from '@ixa/render/composition'
import { Player } from '@remotion/player'

/**
 * `@remotion/player` を抱える内側の部品（ADR-0051）。`window` 前提なので、親が `next/dynamic` の
 * `ssr: false` でここだけを遅れて読む（`program-monitor-player.tsx` と同じ。L-019）。
 *
 * 描くのは `packages/render` の `ThumbnailComposition` **そのもの**。worker の `renderStill` と同じ部品・
 * 同じ大きさ・同じ fps・同じ尺（`thumbnailMetadata`）で描くので、ここで見た 1 枚がそのまま JPEG になる。
 * 書き出しは常に頭の 1 コマ（タイムラインのコマは中で止めてある）なので、再生はしない。
 */
export const ThumbnailPlayer = ({ props }: { readonly props: ThumbnailCompositionProps }) => {
  const metadata = thumbnailMetadata(props)
  return (
    <Player
      component={ThumbnailComposition}
      inputProps={props}
      compositionWidth={metadata.width}
      compositionHeight={metadata.height}
      fps={metadata.fps}
      durationInFrames={metadata.durationInFrames}
      controls={false}
      clickToPlay={false}
      doubleClickToFullscreen={false}
      spaceKeyToPlayOrPause={false}
      acknowledgeRemotionLicense
      style={{ width: '100%', aspectRatio: `${String(metadata.width)} / ${String(metadata.height)}` }}
    />
  )
}
