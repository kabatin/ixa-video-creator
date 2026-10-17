import { THUMBNAIL_SIZE, ThumbnailSpec, type TimelineDocument } from '@ixa/domain'
import type React from 'react'
import { Composition } from 'remotion'
import { THUMBNAIL_COMPOSITION_ID, TIMELINE_COMPOSITION_ID } from '../composition-id.js'
import { totalFrames } from '../timing.js'
import { ThumbnailComposition } from './Thumbnail.js'
import { thumbnailMetadata } from './thumbnail-layout.js'
import type { ThumbnailCompositionProps } from './thumbnail-props.js'
import { TimelineComposition, type TimelineCompositionProps } from './Timeline.js'

/**
 * Remotion Studio で開いたときの表示用。
 * 実レンダリングでは `inputProps` が必ず上書きするので、中身は空でよい。
 */
const EMPTY_DOCUMENT: TimelineDocument = {
  version: 1,
  fps: 30,
  resolution: { width: 1920, height: 1080 },
  durationSec: 1,
  video1: [],
  transitions: [],
  clips: [],
  audio: [],
}

const DEFAULT_PROPS: TimelineCompositionProps = {
  doc: EMPTY_DOCUMENT,
  canvas: null,
}

/** Studio で開いたときのサムネイル（ADR-0051）。実際は `inputProps` が上書きする。 */
const DEFAULT_THUMBNAIL_PROPS: ThumbnailCompositionProps = {
  spec: ThumbnailSpec.parse({
    background: { kind: 'timeline_frame', atSec: 0 },
    title: 'サムネイル',
  }),
  source: { kind: 'timeline_frame', doc: EMPTY_DOCUMENT },
}

/**
 * コンポジション登録。
 * 尺・fps・解像度は **props から算出する**（`calculateMetadata`）。
 * ここを固定値にすると `TimelineDocument.durationSec` と出力尺がずれる。
 */
export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id={TIMELINE_COMPOSITION_ID}
      component={TimelineComposition}
      defaultProps={DEFAULT_PROPS}
      fps={EMPTY_DOCUMENT.fps}
      durationInFrames={totalFrames(EMPTY_DOCUMENT.durationSec, EMPTY_DOCUMENT.fps)}
      width={EMPTY_DOCUMENT.resolution.width}
      height={EMPTY_DOCUMENT.resolution.height}
      calculateMetadata={({ props }) => {
        const canvas = props.canvas ?? props.doc.resolution
        return {
          fps: props.doc.fps,
          durationInFrames: totalFrames(props.doc.durationSec, props.doc.fps),
          width: canvas.width,
          height: canvas.height,
        }
      }}
    />
    {/* サムネイル（ADR-0051）。大きさ・fps・尺は画面の Player と同じ `thumbnailMetadata` で決める。 */}
    <Composition
      id={THUMBNAIL_COMPOSITION_ID}
      component={ThumbnailComposition}
      defaultProps={DEFAULT_THUMBNAIL_PROPS}
      fps={EMPTY_DOCUMENT.fps}
      durationInFrames={1}
      width={THUMBNAIL_SIZE.width}
      height={THUMBNAIL_SIZE.height}
      calculateMetadata={({ props }) => thumbnailMetadata(props)}
    />
  </>
)
