import type { MediaAssetId } from '@ixa/domain'
import { formatClock } from '@/lib/format-time'
import type { WireSfxJob } from '@/lib/sfx-job-api'
import type { WireTimelineClip } from '@/lib/timeline-api'
import type { WireUploadedSfx } from '@/lib/uploaded-sfx-api'

/**
 * 素材ツリーの「効果音」（ADR-0052）。**React を含まない。**
 *
 * 音 1 本（素材）ごとに 1 行。効果音の段に置いたクリップの音と、手元の AI で作った音・手元のファイルから取り込んだ音
 * （ADR-0056。置いていない候補も）を合わせる。
 * 同じ音を何か所に置いても 1 行にまとめ、置いた位置を添える。
 */

/** 効果音の段に置いた 1 か所。 */
export type SfxPlacement = {
  readonly clipId: WireTimelineClip['id']
  readonly startSec: number
  /** 素材のどこから鳴らすか（秒）。 */
  readonly inSec: number
  /**
   * 鳴らす長さ（秒）。**クリップの `durationSec` が正**（レンダラは `inSec` から `durationSec` だけ鳴らし、
   * `outSec` は見ない。帯で端をつまむと書かれるのは `startSec` / `durationSec` だけ）。
   */
  readonly durationSec: number
}

export type SfxTreeItem = {
  readonly mediaAssetId: MediaAssetId
  /** 画面に出す名前。作った音はきっかけの文、取り込んだ音はファイルの名前、段に直に落とした音は置いた位置。 */
  readonly label: string
  /** 置いた位置（早い順）。まだ置いていない候補は空。 */
  readonly placements: readonly SfxPlacement[]
}

/** 名前の長さの上限（文字）。きっかけの文は長いことがある。 */
export const SFX_LABEL_MAX_CHARS = 60

const shorten = (text: string): string => {
  const trimmed = text.trim()
  return trimmed.length <= SFX_LABEL_MAX_CHARS ? trimmed : `${trimmed.slice(0, SFX_LABEL_MAX_CHARS - 1)}…`
}

/** 作った音の名前（きっかけの文）。1 回に何本か作ったときは 2 本目から「候補 n」を添える。 */
export const sfxSoundLabel = (prompt: string, index: number): string =>
  index === 0 ? shorten(prompt) : `${shorten(prompt)}（候補 ${String(index + 1)}）`

/**
 * 作った音の名前。ジョブは新しい順に届く。同じ素材が複数のジョブにあれば**新しいジョブの文**を使う
 * （先に入れたものを残す）。
 */
const jobLabels = (jobs: readonly WireSfxJob[]): ReadonlyMap<MediaAssetId, string> =>
  jobs
    .filter((job) => job.status === 'succeeded')
    .flatMap((job) => job.mediaAssetIds.map((id, index) => ({ id, label: sfxSoundLabel(job.cue.prompt, index) })))
    .reduce<ReadonlyMap<MediaAssetId, string>>(
      (acc, { id, label }) => (acc.has(id) ? acc : new Map([...acc, [id, label]])),
      new Map(),
    )

const placementsOf = (clips: readonly WireTimelineClip[]): ReadonlyMap<MediaAssetId, readonly SfxPlacement[]> =>
  clips
    .filter((clip) => clip.track === 'SFX')
    .flatMap((clip) =>
      clip.content.type === 'media'
        ? [
            {
              mediaAssetId: clip.content.mediaAssetId,
              placement: {
                clipId: clip.id,
                startSec: clip.startSec,
                inSec: clip.content.inSec,
                durationSec: clip.durationSec,
              },
            },
          ]
        : [],
    )
    .sort((a, b) => a.placement.startSec - b.placement.startSec)
    .reduce<ReadonlyMap<MediaAssetId, readonly SfxPlacement[]>>(
      (acc, { mediaAssetId, placement }) =>
        new Map([...acc, [mediaAssetId, [...(acc.get(mediaAssetId) ?? []), placement]]]),
      new Map(),
    )

/** 取り込んだ音の名前。作った音の名前があればそちらを残す（同じ素材を両方が指すことは普通は無い）。 */
const withUploadLabels = (
  labels: ReadonlyMap<MediaAssetId, string>,
  uploads: readonly WireUploadedSfx[],
): ReadonlyMap<MediaAssetId, string> =>
  uploads.reduce<ReadonlyMap<MediaAssetId, string>>(
    (acc, upload) => (acc.has(upload.mediaAssetId) ? acc : new Map([...acc, [upload.mediaAssetId, shorten(upload.title)]])),
    labels,
  )

/**
 * 並びは置いた位置の早い順、置いていない候補はそのあと（作った音の新しい順、続けて取り込んだ音の新しい順）。
 * ID はどれも読み込みの境界で検証済み。
 */
export const sfxTreeItems = (
  clips: readonly WireTimelineClip[],
  jobs: readonly WireSfxJob[],
  uploads: readonly WireUploadedSfx[] = [],
): readonly SfxTreeItem[] => {
  const labels = withUploadLabels(jobLabels(jobs), uploads)
  const placements = placementsOf(clips)
  const unplaced = [...labels.keys()].filter((id) => !placements.has(id))
  return [...placements.keys(), ...unplaced].map((id) => {
    const placed = placements.get(id) ?? []
    const first = placed[0]
    const label = labels.get(id) ?? (first === undefined ? '効果音' : `効果音（${formatClock(first.startSec)}）`)
    return { mediaAssetId: id, label, placements: placed }
  })
}
