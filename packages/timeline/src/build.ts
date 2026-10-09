import type {
  DuckingSettings,
  MediaAssetId,
  Project,
  RenderableClip,
  Seconds,
  Shot,
  TimelineClip,
  TimelineDocument,
  Transition,
} from '@ixa/domain'
import { clipsEndSec, shotsEndSec, sortClips, sortShotsByStart } from './ordering.js'
import { shotPlaybackRate } from './speed.js'

/** 音楽トラックの投影。 */
export type TimelineMusicTrack = {
  readonly mediaUrl: string
  readonly startSec: Seconds
  /** 音源の尺。ミュージックビデオでは音楽がタイムライン全体の尺を決める。 */
  readonly durationSec: Seconds
  readonly volume: number
  /** 頭と終わりのフェード（秒。ADR-0039）。無ければ 0。 */
  readonly fadeInSec?: Seconds
  readonly fadeOutSec?: Seconds
}

/**
 * ナレーション・セリフの 1 行の声の投影（ADR-0038）。行の位置に、選んだ Take の音を置く。
 * 録音の Take は 1 つの音の区間を指すので、区間の頭（`inSec`）も渡す。
 */
export type TimelineVoice = {
  readonly mediaUrl: string
  readonly startSec: Seconds
  readonly durationSec: Seconds
  /** 音のファイルの中の区間の頭（秒）。 */
  readonly inSec: Seconds
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
  /** ナレーション・セリフの声（ADR-0038）。置いて声を選んだ行だけ。無ければ無し。 */
  readonly voices?: readonly TimelineVoice[]
  /** ナレーションの間に曲を下げる設定（ADR-0039）。無ければ下げない。 */
  readonly ducking?: DuckingSettings
  /** Shot の採用 Take のメディア URL を引く。未生成の Shot は undefined を返してよい。 */
  readonly resolveShotMedia: (shot: Shot) => string | undefined
  /**
   * 採用 Take の素材 ID（ADR-0045）。書き出しの直前に大きさを引いて、Project と違うものだけ拡大する。
   * 省略すれば文書に載せない（A/B 比較など、書き出さない口）。
   */
  readonly resolveShotMediaAssetId?: (shot: Shot) => MediaAssetId | undefined
  /**
   * 採用 Take の長さ（秒）。尺に合わせる速度と「Take が足りない」の検査に使う（ADR-0026）。
   * 省略・null は「分からない」。分からなければ速度は 1 にし、足りないとも言わない。
   */
  readonly resolveShotMediaDurationSec?: (shot: Shot) => number | null
  /**
   * 採用 Take が無い Shot の絵コンテの画像（最初のフレーム）の URL。無ければ undefined。
   * **Take があれば使わない**（Take が勝つ）。省略すれば絵は出さない（A/B 比較など、Take だけを映す口）。
   */
  readonly resolveShotStill?: (shot: Shot) => string | undefined
  /**
   * クリップのメディアを URL と種別に解決する。解決できなければ undefined を返してよい。
   * レンダラは ID を URL に解決できないため、ここで解決しておく（video1 と同じ扱い）。
   */
  readonly resolveClipMedia: (
    mediaAssetId: MediaAssetId,
  ) => { readonly url: string; readonly kind: 'image' | 'video' | 'audio' } | undefined
}

/**
 * DB 上のクリップを、レンダリング可能な形へ変換する。
 * 解決できなかったメディアは無言で消さず `unresolved` として残す。
 * 消すと「なぜ出ないのか」が分からなくなるため。
 */
const toRenderableClip = (
  clip: TimelineClip,
  resolve: TimelineSource['resolveClipMedia'],
): RenderableClip => {
  const base = {
    id: clip.id,
    track: clip.track,
    startSec: clip.startSec,
    durationSec: clip.durationSec,
    layer: clip.layer,
    opacity: clip.opacity,
  }

  if (clip.content.type !== 'media') return { ...base, content: clip.content }

  const resolved = resolve(clip.content.mediaAssetId)
  if (resolved === undefined) {
    return {
      ...base,
      content: {
        type: 'unresolved',
        reason: `メディアを解決できません: ${clip.content.mediaAssetId}`,
      },
    }
  }

  return {
    ...base,
    content: {
      type: 'media',
      mediaUrl: resolved.url,
      // 書き出しの直前に大きさを引くため（ADR-0045）。DB のクリップが元から持っている。
      mediaAssetId: clip.content.mediaAssetId,
      kind: resolved.kind,
      inSec: clip.content.inSec,
      outSec: clip.content.outSec,
      volume: clip.content.volume,
      ...(clip.content.fadeInSec === undefined ? {} : { fadeInSec: clip.content.fadeInSec }),
      ...(clip.content.fadeOutSec === undefined ? {} : { fadeOutSec: clip.content.fadeOutSec }),
    },
  }
}

/**
 * タイムライン全体の尺。Shot・クリップ・音楽のうち**最も遅く終わるもの**で決まる。
 *
 * 音楽は `TimelineDocument.audio` と同じく尺を持たない（配置位置しか分からない）ため、
 * 開始位置を終端として扱う。音楽が最後の Shot より後ろから始まる場合に尺が伸びる。
 */
export const timelineDurationSec = (source: TimelineSource): Seconds => {
  // 音楽は開始位置ではなく**終了位置**で尺に効く。
  // Shot が曲より短くてもタイムラインを曲の終わりまで伸ばす。
  const musicEnd = source.musicTracks.reduce(
    (latest, track) => Math.max(latest, track.startSec + track.durationSec),
    0,
  )
  // 声も終わりで尺に効く（曲も Shot も無い作品でも、ナレーションが最後まで鳴る）。
  const voiceEnd = (source.voices ?? []).reduce((latest, voice) => Math.max(latest, voice.startSec + voice.durationSec), 0)
  return Math.max(shotsEndSec(source.shots), clipsEndSec(source.clips), musicEnd, voiceEnd)
}

/**
 * VIDEO1 トラック。**Shot 列の投影であり独立実体を持たない**（ADR-0002）。
 *
 * - `startSec` 昇順に並べる
 * - 採用 Take が無い Shot は、絵コンテの画像があればそれを Shot の尺だけ映す（`kind: 'image'`）。
 *   絵も無ければ含めない（未生成の Shot が黒画面として出ないようにする）
 * - `inSec` は `shot.sourceInSec`（生成尺から編集尺を切り出す位置。ADR-0011）。絵は 0
 */
const buildVideo1 = (source: TimelineSource): TimelineDocument['video1'] =>
  sortShotsByStart(source.shots).flatMap((shot): TimelineDocument['video1'] => {
    const mediaUrl = source.resolveShotMedia(shot)
    if (mediaUrl === undefined) {
      const still = source.resolveShotStill?.(shot)
      if (still === undefined) return []
      // 止めた絵なので、速度（尺に合わせる）も切り出し位置も効かない。
      return [
        {
          shotId: shot.id,
          startSec: shot.startSec,
          durationSec: shot.durationSec,
          mediaUrl: still,
          inSec: 0,
          kind: 'image',
        },
      ]
    }
    const playbackRate = shotPlaybackRate(shot, source.resolveShotMediaDurationSec?.(shot) ?? null)
    const mediaAssetId = source.resolveShotMediaAssetId?.(shot)
    return [
      {
        shotId: shot.id,
        startSec: shot.startSec,
        durationSec: shot.durationSec,
        mediaUrl,
        ...(mediaAssetId === undefined ? {} : { mediaAssetId }),
        inSec: shot.sourceInSec,
        // 1 のときは書かない。速度を変えない Shot の文書は今までと同じ形のまま。
        ...(playbackRate === 1 ? {} : { playbackRate }),
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
  clips: sortClips(source.clips).map((clip) => toRenderableClip(clip, source.resolveClipMedia)),
  audio: [
    ...source.musicTracks.map((track) => ({
      mediaUrl: track.mediaUrl,
      startSec: track.startSec,
      durationSec: track.durationSec,
      volume: track.volume,
      ...(track.fadeInSec === undefined || track.fadeInSec <= 0 ? {} : { fadeInSec: track.fadeInSec }),
      ...(track.fadeOutSec === undefined || track.fadeOutSec <= 0 ? {} : { fadeOutSec: track.fadeOutSec }),
    })),
    ...(source.voices ?? []).map((voice) => ({
      mediaUrl: voice.mediaUrl,
      startSec: voice.startSec,
      durationSec: voice.durationSec,
      volume: voice.volume,
      inSec: voice.inSec,
      role: 'voice' as const,
    })),
  ],
  ...(source.ducking === undefined ? {} : { ducking: { ...source.ducking } }),
})
