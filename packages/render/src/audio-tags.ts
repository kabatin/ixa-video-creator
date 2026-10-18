import type { TimelinePlan } from './plan.js'

/**
 * プレビューの Player が前もって用意する `<audio>` の数（Remotion の `numberOfSharedAudioTags` の既定）。
 *
 * 同時に組み立てる音がこれを超えると、Player は例外を投げて止まる。宣伝動画（戦子のタイムトラベル）で、
 * 曲 1 本と、ぴょんぴょん跳ねる足音・題名の衝撃音が重なる 24 秒付近で再生が止まった（2026-10-19）。
 */
export const DEFAULT_SHARED_AUDIO_TAGS = 5

/** 用意する数の刻み。クリップを 1 本足すたびに Player を作り直さない。 */
const TAG_STEP = 4
/** 数え漏れ（境目で付け外しが一瞬重なる等）に備えて足す数。 */
const TAG_HEADROOM = 2

/**
 * 同時に組み立てられる音の最大数。曲・声（`plan.audio`）と、音のクリップ（効果音）を数える。
 *
 * 音のクリップは `premountFrames` だけ前から組み立てる（`timelineLayers` と同じ）ので、
 * その間も鳴っている扱いで数える。始まりと終わりの出来事を時刻順に並べて数える。
 */
export const peakMountedAudio = (plan: TimelinePlan, premountFrames: number): number => {
  const tracks = plan.audio.map((track) => ({
    from: track.range.from,
    to: track.range.from + track.range.durationInFrames,
  }))
  const clips = plan.clips
    .filter((clip) => clip.content.type === 'media' && clip.content.kind === 'audio')
    .map((clip) => ({
      from: clip.range.from - premountFrames,
      to: clip.range.from + clip.range.durationInFrames,
    }))
  // 同じコマで終わる物を先に数える（終わりと始まりが接しているだけなら重ならない）。
  const events = [...tracks, ...clips]
    .flatMap((span) => [
      { at: span.from, delta: 1 },
      { at: span.to, delta: -1 },
    ])
    .sort((a, b) => a.at - b.at || a.delta - b.delta)
  return events.reduce(
    (acc, event) => {
      const current = acc.current + event.delta
      return { current, peak: Math.max(acc.peak, current) }
    },
    { current: 0, peak: 0 },
  ).peak
}

/** 同時に組み立てる数 `peak` に対して用意する `<audio>` の数。必ず `peak` より多く、刻みに丸める。 */
export const sharedAudioTagsFor = (peak: number): number => {
  const needed = peak + TAG_HEADROOM
  if (needed <= DEFAULT_SHARED_AUDIO_TAGS) return DEFAULT_SHARED_AUDIO_TAGS
  return Math.ceil(needed / TAG_STEP) * TAG_STEP
}
