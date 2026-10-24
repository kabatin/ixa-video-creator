import type { TimelineDocument } from '@ixa/domain'

/**
 * プレビューで曲だけを消す（2026-10-24、制作者「効果音だけ確認しやすいように」）。**React を含まない。**
 *
 * 消すのは `audio` の曲（role が無いものも曲）。声（ナレーション）と、`clips` に置いた効果音はそのまま鳴らす。
 * **外さずに音量を 0 にする。** 曲の項目は尺の手がかりでもあり、外すと組み立て直しになる。
 * 書き出しには使わない（プレビューだけの切り替え）。
 */
export const muteMusic = (doc: TimelineDocument): TimelineDocument => ({
  ...doc,
  audio: doc.audio.map((track) => (track.role === 'voice' ? track : { ...track, volume: 0 })),
})
