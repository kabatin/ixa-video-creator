import type { MediaAssetId } from '@ixa/domain'
import type { WireSfxJob } from '@/lib/sfx-job-api'
import { sfxSoundLabel } from '@/lib/sfx-tree'

/**
 * 取り込みの窓の区分（ADR-0034・ADR-0053）。素材ツリーの段と同じ並び・同じ名前。**React を含まない。**
 */

export const LIBRARY_IMPORT_SECTIONS = ['musicTracks', 'sfx', 'characters', 'voices', 'locations', 'brandAssets'] as const
export type LibraryImportSection = (typeof LIBRARY_IMPORT_SECTIONS)[number]

/** 素材ツリーの段の名前と一致させる。 */
export const LIBRARY_IMPORT_SECTION_LABELS: Readonly<Record<LibraryImportSection, string>> = {
  musicTracks: '楽曲',
  sfx: '効果音',
  characters: 'キャラクター',
  voices: '声',
  locations: 'ロケーション',
  brandAssets: 'ブランド資産',
}

/** 区分ごとの添え書き（何を複製し、何を共有するか）。 */
export const LIBRARY_IMPORT_SECTION_NOTES: Readonly<Record<LibraryImportSection, string>> = {
  musicTracks: '音のファイルは同じものを使い、位置・音量・フェード・曲の終わりと拍の解析を複製します。マスターにはしません。',
  sfx: '同じ音を、このプロジェクトの効果音に「置いていない」候補として足します。タイムラインには置きません。',
  characters: 'Look と画像ごと複製します。',
  voices: 'AI・声の種類・声のイメージ・速さなどの設定を複製します。同じ名前があれば名前をずらします。',
  locations: '参照の画像ごと複製します。',
  brandAssets: '色・ロゴをそのまま複製します。',
}

export type SfxImportChoice = {
  /** 1 行の鍵（ジョブと音の組）。チェックの記録に使う。 */
  readonly key: string
  readonly sfxJobId: string
  readonly mediaAssetId: MediaAssetId
  readonly label: string
}

/**
 * 取り込み元で作った効果音を 1 本 1 行で並べる。できたジョブだけ。ジョブは新しい順に届くので、同じ音が
 * 複数のジョブにあれば新しい方の 1 行にまとめる（素材ツリーと同じ名前の付け方）。
 */
export const sfxImportChoices = (jobs: readonly WireSfxJob[]): readonly SfxImportChoice[] =>
  jobs
    .filter((job) => job.status === 'succeeded')
    .flatMap((job) =>
      job.mediaAssetIds.map((mediaAssetId, index) => ({
        key: `${job.id}:${mediaAssetId}`,
        sfxJobId: job.id,
        mediaAssetId,
        label: sfxSoundLabel(job.cue.prompt, index),
      })),
    )
    .filter((choice, index, all) => all.findIndex((other) => other.mediaAssetId === choice.mediaAssetId) === index)
