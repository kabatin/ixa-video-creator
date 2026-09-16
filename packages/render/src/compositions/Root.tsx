import type { TimelineDocument } from '@ixa/domain'
import type React from 'react'
import { Composition } from 'remotion'
import { TIMELINE_COMPOSITION_ID } from '../composition-id.js'
import { totalFrames } from '../timing.js'
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

/**
 * コンポジション登録。
 * 尺・fps・解像度は **props から算出する**（`calculateMetadata`）。
 * ここを固定値にすると `TimelineDocument.durationSec` と出力尺がずれる。
 */
export const RemotionRoot: React.FC = () => (
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
)
