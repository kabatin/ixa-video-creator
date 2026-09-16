import type {
  Project,
  Seconds,
  Shot,
  TimelineClip,
  TimelineDocument,
  Transition,
} from '@ixa/domain'
import { clipsEndSec, shotsEndSec, sortClips, sortShotsByStart } from './ordering.js'

/** 音楽トラックの投影。尺は `TimelineDocument.audio` と同じく持たない。 */
export type TimelineMusicTrack = {
  readonly mediaUrl: string
  readonly startSec: Seconds
  /** 音源の尺。ミュージックビデオでは音楽がタイムライン全体の尺を決める。 */
  readonly durationSec: Seconds
  readonly volume: number
}

/**
 * DB から読んだ素材。`TimelineDocument` を組み立てるのに必要なものだけを持つ。
 * この型は IO を持たない。メディア URL の解決は呼び出し側が関数として渡す。
 */
export type TimelineSource = {
  readonly project: Pick<Project, 'fps' | 'resolution'>
  readonly shots: readonly Shot[]
  readonly transitions: readonly Transition[]
  readonly clips: readonly TimelineClip[]
  readonly musicTracks: readonly TimelineMusicTrack[]
  /** Shot の採用 Take のメディア URL を引く。未生成の Shot は undefined を返してよい。 */
  readonly resolveShotMedia: (shot: Shot) => string | undefined
}

/**
 * タイムライン全体の尺。Shot・クリップ・音楽のうち**最も遅く終わるもの**で決まる。
 *
 * 音楽は `TimelineDocument.audio` と同じく尺を持たない（配置位置しか分からない）ため、
 * 開始位置を終端として扱う。音楽が最後の Shot より後ろから始まる場合に尺が伸びる。
 */
const timelineDurationSec = (source: TimelineSource): Seconds => {
  // 音楽は開始位置ではなく**終了位置**で尺に効く。
  // Shot が曲より短くてもタイムラインを曲の終わりまで伸ばす。
  const musicEnd = source.musicTracks.reduce(
    (latest, track) => Math.max(latest, track.startSec + track.durationSec),
    0,
  )
  return Math.max(shotsEndSec(source.shots), clipsEndSec(source.clips), musicEnd)
}

/**
 * VIDEO1 トラック。**Shot 列の投影であり独立実体を持たない**（ADR-0002）。
 *
 * - `startSec` 昇順に並べる
 * - 採用 Take が無い Shot は含めない（未生成の Shot が黒画面として出ないようにする）
 * - `inSec` は `shot.sourceInSec`（生成尺から編集尺を切り出す位置。ADR-0011）
 */
const buildVideo1 = (source: TimelineSource): TimelineDocument['video1'] =>
  sortShotsByStart(source.shots).flatMap((shot) => {
    const mediaUrl = source.resolveShotMedia(shot)
    if (mediaUrl === undefined) return []
    return [
      {
        shotId: shot.id,
        startSec: shot.startSec,
        durationSec: shot.durationSec,
        mediaUrl,
        inSec: shot.sourceInSec,
      },
    ]
  })

/**
 * Project / Shot / Transition / TimelineClip / MusicTrack を 1 つの純粋な JSON に畳む。
 * **これがプレビュー（@remotion/player）とレンダリング（renderMedia）の共通入力**になる
 * （docs/ARCHITECTURE.md §15）。同じ入力を通すことで書き出し時のズレを構造的に防ぐ。
 *
 * 入力は一切変更しない。常に新しい配列・オブジェクトを返す。
 */
export const buildTimelineDocument = (source: TimelineSource): TimelineDocument => ({
  version: 1,
  fps: source.project.fps,
  resolution: { ...source.project.resolution },
  durationSec: timelineDurationSec(source),
  video1: buildVideo1(source),
  transitions: [...source.transitions],
  clips: sortClips(source.clips),
  audio: source.musicTracks.map((track) => ({
    mediaUrl: track.mediaUrl,
    startSec: track.startSec,
    durationSec: track.durationSec,
    volume: track.volume,
  })),
})
