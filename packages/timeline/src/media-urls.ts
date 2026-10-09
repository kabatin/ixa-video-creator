import type { MediaAssetId, TimelineDocument } from '@ixa/domain'

/**
 * 書き出しの直前に差し替える映像（ADR-0045）。
 *
 * 大きさが枠より小さい素材だけ、worker が Lanczos で拡大したものへ URL を差し替える。
 * ここは**文書の中を見て書き換えるだけ**で、大きさも IO も知らない。
 */

/**
 * 文書に出てくる**映像**の素材 ID（重複なし・出てきた順）。
 *
 * - 絵コンテの画像（`kind: 'image'`）は入れない。止めた絵は拡大の対象外
 * - 素材 ID を持たない項目（前からの書き出しの記録）は入れない。**分からないものは触らない**
 */
export const videoAssetIdsOf = (doc: TimelineDocument): readonly MediaAssetId[] => {
  const fromShots = doc.video1.flatMap((entry) =>
    entry.kind === 'image' || entry.mediaAssetId === undefined ? [] : [entry.mediaAssetId],
  )
  const fromClips = doc.clips.flatMap((clip) =>
    clip.content.type === 'media' && clip.content.kind === 'video' && clip.content.mediaAssetId !== undefined
      ? [clip.content.mediaAssetId]
      : [],
  )
  return [...new Set([...fromShots, ...fromClips])]
}

/**
 * 素材 ID ごとの URL を差し替えた**新しい**文書。表に無い素材はそのまま。
 * 表が空なら同じ文書を返す（書き出しの経路を変えない）。
 */
export const withMediaUrls = (
  doc: TimelineDocument,
  urls: ReadonlyMap<MediaAssetId, string>,
): TimelineDocument => {
  if (urls.size === 0) return doc
  const urlOf = (id: MediaAssetId | undefined): string | undefined =>
    id === undefined ? undefined : urls.get(id)
  return {
    ...doc,
    video1: doc.video1.map((entry) => {
      const url = entry.kind === 'image' ? undefined : urlOf(entry.mediaAssetId)
      return url === undefined ? entry : { ...entry, mediaUrl: url }
    }),
    clips: doc.clips.map((clip) => {
      if (clip.content.type !== 'media' || clip.content.kind !== 'video') return clip
      const url = urlOf(clip.content.mediaAssetId)
      return url === undefined ? clip : { ...clip, content: { ...clip.content, mediaUrl: url } }
    }),
  }
}
