import { z } from 'zod'
import { DuckingSettings } from '../audio/mix.js'
import { MediaAssetId, ProjectId, ShotId, TimelineClipId } from '../common/ids.js'
import { Resolution, Seconds } from '../common/time.js'
import { Transition } from '../shot/shot.js'

/** VIDEO1 は Shot の投影なので TimelineClip を持たない（ADR-0002）。 */
export const TimelineTrack = z.enum(['VFX', 'TEXT', 'VIDEO2', 'SFX'])
export type TimelineTrack = z.infer<typeof TimelineTrack>

/** 音のクリップ（効果音）のフェードの上限（秒。楽曲と同じ）。 */
export const CLIP_FADE_MAX_SEC = 30

export const TimelineClipContent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('media'),
    mediaAssetId: MediaAssetId,
    inSec: Seconds,
    outSec: Seconds,
    volume: z.number().min(0).max(2).default(1),
    /** フェード（ADR-0039。音のクリップだけが使う）。省けば付けない（前からあるクリップはそのまま読める）。 */
    fadeInSec: Seconds.max(CLIP_FADE_MAX_SEC).optional(),
    fadeOutSec: Seconds.max(CLIP_FADE_MAX_SEC).optional(),
  }),
  z.object({
    type: z.literal('text'),
    templateKey: z.string().min(1),
    params: z.record(z.unknown()).default({}),
  }),
  z.object({
    type: z.literal('motion_graphics'),
    templateKey: z.string().min(1),
    params: z.record(z.unknown()).default({}),
  }),
])
export type TimelineClipContent = z.infer<typeof TimelineClipContent>

export const TimelineClip = z.object({
  id: TimelineClipId,
  projectId: ProjectId,
  track: TimelineTrack,
  startSec: Seconds,
  durationSec: Seconds,
  layer: z.number().int().nonnegative().default(0),
  content: TimelineClipContent,
  opacity: z.number().min(0).max(1).default(1),
  createdAt: z.date(),
})
export type TimelineClip = z.infer<typeof TimelineClip>

export const CreateTimelineClipInput = TimelineClip.omit({ id: true, createdAt: true })
export type CreateTimelineClipInput = z.input<typeof CreateTimelineClipInput>

/** projectId は変更できない。クリップを別プロジェクトへ移す操作は想定しない。 */
export const UpdateTimelineClipPatch = TimelineClip.pick({
  track: true, startSec: true, durationSec: true, layer: true, content: true, opacity: true,
}).partial()
export type UpdateTimelineClipPatch = z.input<typeof UpdateTimelineClipPatch>

/**
 * レンダリング時のクリップ内容。
 *
 * DB 上の `TimelineClip` は `mediaAssetId` を持つが、レンダラは ID を URL に解決できない
 * （Port は `render(doc, preset, onProgress)` で、リポジトリもストレージも受け取らない）。
 * **`video1` が `mediaUrl` を持つのと同じく、クリップも構築時に解決済みの URL を持つ。**
 */
export const RenderableClipContent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('media'),
    mediaUrl: z.string(),
    /**
     * 元の素材（ADR-0045）。書き出しの直前に、大きさが Project と違う素材だけを拡大するのに使う。
     * **省略可能にして version は 1 のまま**（無ければ「分からない＝触らない」）。
     */
    mediaAssetId: MediaAssetId.optional(),
    /** OffthreadVideo と Img の分岐に使う。拡張子で推測しない。 */
    kind: z.enum(['image', 'video', 'audio']),
    inSec: Seconds,
    outSec: Seconds,
    volume: z.number().min(0).max(2),
    fadeInSec: Seconds.optional(),
    fadeOutSec: Seconds.optional(),
  }),
  z.object({
    type: z.literal('text'),
    templateKey: z.string().min(1),
    params: z.record(z.unknown()),
  }),
  z.object({
    type: z.literal('motion_graphics'),
    templateKey: z.string().min(1),
    params: z.record(z.unknown()),
  }),
  /** 参照先のメディアを解決できなかったクリップ。無言で消さず、絵で分かるようにする。 */
  z.object({
    type: z.literal('unresolved'),
    reason: z.string(),
  }),
])
export type RenderableClipContent = z.infer<typeof RenderableClipContent>

export const RenderableClip = z.object({
  id: TimelineClipId,
  track: TimelineTrack,
  startSec: Seconds,
  durationSec: Seconds,
  layer: z.number().int().nonnegative(),
  content: RenderableClipContent,
  opacity: z.number().min(0).max(1),
})
export type RenderableClip = z.infer<typeof RenderableClip>

/**
 * プレビューとレンダリングの共通入力。
 * これが同一であることで「プレビューでは合っていたのに書き出すとズレる」を構造的に防ぐ。
 */
export const TimelineDocument = z.object({
  version: z.literal(1),
  fps: z.number().positive(),
  resolution: Resolution,
  durationSec: Seconds,
  video1: z.array(
    z.object({
      shotId: ShotId,
      startSec: Seconds,
      durationSec: Seconds,
      mediaUrl: z.string(),
      /**
       * 採用 Take の素材（ADR-0045）。書き出しの直前に、大きさが Project と違う素材だけを拡大するのに使う。
       * 絵コンテの画像（`kind: 'image'`）には付けない。**省略可能にして version は 1 のまま**
       * （前からの書き出しの記録には無い。無ければ「分からない＝触らない」）。
       */
      mediaAssetId: MediaAssetId.optional(),
      inSec: Seconds,
      /**
       * 再生速度（ADR-0026）。尺に合わせる Shot だけが持つ。**無ければ 1**。
       * 省略可能にして version は 1 のまま（過去の書き出し記録もそのまま読める）。
       */
      playbackRate: z.number().positive().optional(),
      /**
       * 映すものの種類。**無ければ video**（採用 Take）。`image` は Take が無い Shot の絵コンテの画像（最初のフレーム）で、
       * Shot の尺だけ止めて映す（制作者 2026-10-02。プレビューにも書き出しにも出す）。省略可能にして version は 1 のまま。
       */
      kind: z.enum(['video', 'image']).optional(),
    }),
  ),
  transitions: z.array(Transition),
  clips: z.array(RenderableClip),
  audio: z.array(
    z.object({
      mediaUrl: z.string(),
      startSec: Seconds,
      /**
       * 音源の尺。ミュージックビデオでは**音楽がタイムライン全体の尺を決める**ため必須。
       * これが無いと、Shot が曲より短いときにタイムラインが途中で切れる。
       */
      durationSec: Seconds,
      volume: z.number().min(0).max(2),
      /**
       * 音源のどこから鳴らすか（秒）。**無ければ 0**（頭から）。一部だけを書き出すとき、区間の頭に当たる音から鳴らす
       * （制作者 2026-10-02「選択した Shot だけを動画として出力」）。省略可能にして version は 1 のまま。
       */
      inSec: Seconds.optional(),
      /**
       * 何の音か（ADR-0038）。**無ければ曲**（前からの書き出しの記録と同じ形）。声（ナレーション・セリフ）の間は曲を下げる。
       */
      role: z.enum(['music', 'voice']).optional(),
      /** 頭と終わりのフェード（秒。ADR-0039）。無ければ 0。 */
      fadeInSec: Seconds.optional(),
      fadeOutSec: Seconds.optional(),
    }),
  ),
  /** ナレーションの間に曲を下げる設定（ADR-0039）。無ければ下げない。 */
  ducking: DuckingSettings.optional(),
})
export type TimelineDocument = z.infer<typeof TimelineDocument>
