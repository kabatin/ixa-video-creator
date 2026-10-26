import { MediaAssetId, type Shot, type TimelineClip } from '@ixa/domain'
import type { TimelineSource } from '../build.js'
import { PROJECT_ID, clipId, makeShot, makeTransition, shotId } from './fixtures.js'

/**
 * セリフの無い MV（ADR-0060 の前後比較）。本制作（iXA CUP MV）の形を写した。
 *
 * - 24fps・1920×1080。曲 1 本（頭と尻のフェード・曲の終わり）、テロップ、効果音（フェード付き）、VIDEO2 の素材
 * - Take は AI の動画で、**多くは音のトラックを持つ**（Take の音を鳴らさないことを確かめるのはここ）
 * - 尺に合わせた Shot（速度 1 以外）、速めた Shot、絵コンテの画像だけの Shot、Take の頭を切った Shot
 * - ディゾルブと暗転。ナレーション 1 行と、その間に曲を下げる設定
 * - **Shot はマイグレーション 0057 を通った形**（消音は自動。セリフが無いので鳴らない）
 */

const EPOCH = new Date('2026-09-16T00:00:00.000Z')
const asset = (n: number): MediaAssetId => MediaAssetId.parse(`01ARZ3NDEKTSV4RRFFQ69G5M${n.toString().padStart(2, '0')}`)

/** 0057 を通った前からの Shot（消音は自動・大きさ 1）。セリフが無いので鳴らない。 */
const migrated = (n: number, startSec: number, durationSec: number, overrides: Partial<Shot> = {}): Shot =>
  makeShot(n, startSec, durationSec, { takeAudioMuted: null, takeAudioVolume: 1, ...overrides })

export const MV_SHOTS: readonly Shot[] = [
  migrated(1, 0, 3.75),
  migrated(2, 3.75, 2.5, { timing: 'fit' }),
  migrated(3, 6.25, 4, { sourceInSec: 0.5 }),
  migrated(4, 10.25, 2, { speed: 1.5 }),
  // 絵コンテの画像だけ（Take が無い）
  migrated(5, 12.25, 1.75),
  migrated(6, 14, 3, { takeAudioVolume: 1.4 }),
]

const textClip: TimelineClip = {
  id: clipId(41),
  projectId: PROJECT_ID,
  track: 'TEXT',
  startSec: 1,
  durationSec: 2.5,
  layer: 2,
  content: { type: 'text', templateKey: 'lower_third', params: { text: 'iXA CUP' } },
  opacity: 1,
  createdAt: EPOCH,
}

const sfxClip: TimelineClip = {
  id: clipId(42),
  projectId: PROJECT_ID,
  track: 'SFX',
  startSec: 6.25,
  durationSec: 1.2,
  layer: 0,
  content: { type: 'media', mediaAssetId: asset(42), inSec: 0.1, outSec: 1.3, volume: 0.8, fadeInSec: 0.05, fadeOutSec: 0.3 },
  opacity: 1,
  createdAt: EPOCH,
}

const overlayClip: TimelineClip = {
  id: clipId(43),
  projectId: PROJECT_ID,
  track: 'VIDEO2',
  startSec: 14,
  durationSec: 2,
  layer: 0,
  content: { type: 'media', mediaAssetId: asset(43), inSec: 0, outSec: 2, volume: 1 },
  opacity: 0.6,
  createdAt: EPOCH,
}

/** 採用 Take の長さ（秒）。fit の Shot は 3 秒の Take を 2.5 秒に収める。 */
const TAKE_SEC: Readonly<Record<string, number>> = { S1: 5, S2: 3, S3: 5, S4: 4, S6: 5 }
/** 音のトラックがある Take。S3 だけ無い（無音の Take もある）。 */
const TAKE_HAS_AUDIO: ReadonlySet<string> = new Set(['S1', 'S2', 'S4', 'S6'])

export const MV_SOURCE: TimelineSource = {
  project: { fps: 24, resolution: { width: 1920, height: 1080 } },
  shots: MV_SHOTS,
  transitions: [
    makeTransition(51, shotId(1), shotId(2), 0.5),
    { ...makeTransition(52, shotId(3), shotId(4), 0.4), type: 'dip_to_black' },
  ],
  clips: [textClip, sfxClip, overlayClip],
  musicTracks: [
    { mediaUrl: 'https://media.test/music.wav', startSec: 0, durationSec: 20, volume: 0.9, fadeInSec: 0.5, fadeOutSec: 2, endSec: 17 },
  ],
  // ナレーション 1 行と、その間に曲を下げる設定（ADR-0038・0039）。
  voices: [{ mediaUrl: 'https://media.test/voice.wav', startSec: 8, durationSec: 1.5, inSec: 0.2, volume: 1 }],
  ducking: { enabled: true, depthDb: 10, attackSec: 0.15, releaseSec: 0.4 },
  resolveShotMedia: (shot) => (shot.code === 'S5' ? undefined : `https://media.test/${shot.code}.mp4`),
  resolveShotMediaAssetId: (shot) => (shot.code === 'S5' ? undefined : asset(shot.order / 1000)),
  resolveShotMediaDurationSec: (shot) => TAKE_SEC[shot.code] ?? null,
  resolveShotMediaHasAudio: (shot) => TAKE_HAS_AUDIO.has(shot.code),
  resolveShotStill: (shot) => (shot.code === 'S5' ? 'https://media.test/S5.png' : undefined),
  resolveClipMedia: (id) =>
    id === asset(42)
      ? { url: 'https://media.test/sfx.wav', kind: 'audio' as const }
      : { url: `https://media.test/${id}.mp4`, kind: 'video' as const },
}
