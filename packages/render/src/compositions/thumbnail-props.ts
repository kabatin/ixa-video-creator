import type { ThumbnailSpec, TimelineDocument } from '@ixa/domain'

/**
 * Thumbnail コンポジションの入力（ADR-0051）。**画面の Player と worker の renderStill が同じものを渡す。**
 *
 * `spec` の背景は「どれを描くか」（秒・素材の ID）だけを持ち、描くための材料はここで渡す:
 * - `timeline_frame`: TimelineDocument（署名付き URL 入り）。`spec.background.atSec` のコマに止めて描く
 * - `image`: 素材の URL（署名付き。画面は API から、worker は描く直前に発行する）
 *
 * React を読み込まない側（worker の配線・renderer.ts）からも使うため、型だけのファイルに置く。
 */
export type ThumbnailBackgroundSource =
  | { readonly kind: 'timeline_frame'; readonly doc: TimelineDocument }
  | { readonly kind: 'image'; readonly url: string }

export type ThumbnailCompositionProps = {
  readonly spec: ThumbnailSpec
  readonly source: ThumbnailBackgroundSource
}

export type RenderThumbnailStillInput = {
  readonly props: ThumbnailCompositionProps
  /** JPEG を書くディレクトリ。無ければ作る。 */
  readonly outputDir: string
}

export type RenderThumbnailStillResult = {
  /** 書いた JPEG のローカルのパス。 */
  readonly path: string
  readonly bytes: number
  /** 最後に使った JPEG の画質（2 MB を超えたら下げて描き直す）。 */
  readonly jpegQuality: number
}

/** `renderThumbnailStill` の形。worker はこの型で受け取り、テストでは差し替える。 */
export type RenderThumbnailStill = (input: RenderThumbnailStillInput) => Promise<RenderThumbnailStillResult>
