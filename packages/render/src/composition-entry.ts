/**
 * ブラウザから読める入口（`@ixa/render/composition`）。
 *
 * **なぜ `index.ts` と分けるか。**
 * `index.ts` は `renderer.ts` / `bundle-cache.ts` / `ffmpeg-renderer.ts` を再輸出しており、
 * それらは `@remotion/renderer` / `@remotion/bundler` / `node:fs` / `node:path` を読み込む。
 * ブラウザのバンドルに載せると解決に失敗するか、載ったとしても巨大な死荷重になる。
 *
 * プレビュー（`@remotion/player`）とレンダリング（`renderMedia`）は
 * **同じ `TimelineComposition` と同じ `TimelineDocument`** を入力にする（ADR-0010）。
 * 「プレビューでは合っていたのに書き出すとズレる」を構造的に防ぐのが目的なので、
 * ここで画面用のコンポジションを別に作ってはいけない。輸出するだけにする。
 *
 * **`export *` を使わない。** 元のモジュールに輸出が増えたとき、
 * Node 専用の物が黙ってブラウザ側へ流れ込むのを防ぐため、名前を 1 つずつ書く。
 * この方針は `__tests__/composition-entry.test.ts` が固定している。
 */

export { THUMBNAIL_COMPOSITION_ID, TIMELINE_COMPOSITION_ID } from './composition-id.js'

// サムネイル（ADR-0051）。画面の Player と worker の renderStill が同じコンポジションと同じ大きさの決め方を使う。
export { ThumbnailComposition } from './compositions/Thumbnail.js'
export { thumbnailMetadata } from './compositions/thumbnail-layout.js'
export type { ThumbnailBackgroundSource, ThumbnailCompositionProps } from './compositions/thumbnail-props.js'

export { TimelineComposition, ClipBody, ClipMedia, PREMOUNT_SEC } from './compositions/Timeline.js'

// プレビューの Player が用意する <audio> の数（同時に鳴る音が多いと止まるため）。
export { DEFAULT_SHARED_AUDIO_TAGS, peakMountedAudio, sharedAudioTagsFor } from './audio-tags.js'
export type { TimelineCompositionProps } from './compositions/Timeline.js'

export { buildTimelinePlan, TRANSITION_SUPPORT } from './plan.js'
export type {
  AudioPlan,
  ClipPlan,
  DegradedTransition,
  DipPlan,
  ShotPlan,
  TimelinePlan,
} from './plan.js'

export { frameRange, sourceOffsetFrames, totalFrames } from './timing.js'
export type { FrameRange } from './timing.js'

export { PRESET_SETTINGS, letterboxFit, presetResolution } from './presets.js'
export type { FitRect, PresetSettings } from './presets.js'
