/**
 * `selectComposition` / `renderMedia` から参照するコンポジション ID。
 * React を読み込まない側（renderer.ts）からも使うため、Root.tsx とは別ファイルに置く。
 */
export const TIMELINE_COMPOSITION_ID = 'Timeline'

/** YouTube のサムネイル（ADR-0051）。1280×720・1 コマ。同じバンドルに入る。 */
export const THUMBNAIL_COMPOSITION_ID = 'Thumbnail'
