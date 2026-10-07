import { link, mkdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { MediaAssetRepository, ShotReferenceRepository, ShotRepository, TakeRepository } from '@ixa/db'
import {
  ASSET_FOLDER_NAME,
  startFrameExportFileName,
  takeExportFileName,
  type MediaAsset,
  type Project,
  type Shot,
  type ShotId,
} from '@ixa/domain'
import { ObjectNotFoundError, type FsStorage } from '@ixa/storage'
import type { Logger } from '../logger.js'
import { exists, inside, projectFolder } from '../render-folder/render-folder.js'
import { sequentially } from '../sequentially.js'

/**
 * 作った素材を、作品ごとのフォルダから開けるようにする（ADR-0041。制作者 2026-10-07
 * 「作った素材は個別に何かに使いたいこともあると思うので、普通にフォルダ開いて見れるといいな」）。
 *
 * 保管庫の置き方は `media/<ULID>/<ULID>/original.mp4` で、Finder で開けても**どれが何か分からない**。
 * そこで `~/Movies/ixa-video-creator/<作品名>/素材/` に、Shot の順に並ぶ読める名前を付ける。
 *
 * **コピーではなくハードリンクを張る。** 同じ中身を 2 つ持たないので容量が増えず、
 * 利用者がここのファイルを消しても保管庫の方は無傷。書き出し（ADR-0036）と同じで、
 * **もう入っているものは触らない**（`~/Movies` は利用者が触る場所）。
 */

export type AssetFolderDeps = {
  readonly shots: Pick<ShotRepository, 'findByProject'>
  readonly takes: Pick<TakeRepository, 'findByShot'>
  readonly shotReferences: Pick<ShotReferenceRepository, 'findByShot'>
  readonly mediaAssets: Pick<MediaAssetRepository, 'findById'>
  /**
   * 手元のファイルの場所を聞ける保管庫。
   * **`fs` のときだけこの機能を置く**（`s3` には手元のファイルが無いので、張るものが無い）。
   */
  readonly storage: Pick<FsStorage, 'localPath'>
  /** 書き出しフォルダと同じ根（例: `~/Movies/ixa-video-creator`）。作品フォルダの下に `素材/` を作る。 */
  readonly rootDir: string
  readonly logger: Logger
}

export type AssetFolderFailure = { readonly shotId: ShotId; readonly reason: string }

export type AssetFolderResult = {
  readonly folder: string
  /** いま張った数。もう入っていたものは数えない。 */
  readonly linked: number
  readonly failed: readonly AssetFolderFailure[]
}

/** 作品フォルダの下の `素材/`。外を指していれば止める（2 重の柵）。 */
export const assetFolder = (rootDir: string, project: Pick<Project, 'name'>): string => {
  const parent = projectFolder(rootDir, project)
  return inside(parent, join(parent, ASSET_FOLDER_NAME))
}

/** 入れるもの 1 つ分（どの素材を、どの名前で）。 */
type Entry = { readonly asset: MediaAsset; readonly name: string }

const extensionOf = (asset: MediaAsset): string => extname(asset.storageKey).replace('.', '')

/** その Shot から入れるもの。Take（採用が分かるように）と、最初のフレーム（ADR-0025）。 */
const entriesOf = async (deps: AssetFolderDeps, shot: Shot): Promise<readonly Entry[]> => {
  const takes = await deps.takes.findByShot(shot.id)
  const fromTakes = await Promise.all(
    takes.map(async (take) => {
      const asset = await deps.mediaAssets.findById(take.mediaAssetId)
      if (asset === null) return []
      return [
        {
          asset,
          name: takeExportFileName({
            shotCode: shot.code,
            takeIndex: take.index,
            selected: shot.selectedTakeId === take.id,
            extension: extensionOf(asset),
          }),
        },
      ]
    }),
  )

  const startFrame = (await deps.shotReferences.findByShot(shot.id)).find(
    (reference) => reference.role === 'start_frame',
  )
  const frameAsset = startFrame === undefined ? null : await deps.mediaAssets.findById(startFrame.mediaAssetId)

  return [
    ...fromTakes.flat(),
    ...(frameAsset === null
      ? []
      : [{ asset: frameAsset, name: startFrameExportFileName(shot.code, extensionOf(frameAsset)) }]),
  ]
}

const reasonOf = (error: unknown, name: string): string => {
  if (error instanceof ObjectNotFoundError) return `「${name}」: 元の素材が見つかりません`
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code
    // ハードリンクは同じディスクの中にしか張れない。コピーには落とさず、何が起きたかを言う。
    if (code === 'EXDEV') {
      return `「${name}」: 素材の置き場と書き出しフォルダが別のディスクにあるため、ここには入れられません`
    }
  }
  return `「${name}」: フォルダに入れられませんでした`
}

/**
 * 1 つ張る。もう入っていれば何もしない（`false`）。
 *
 * **先に「もう入っているか」を見る。** 後から見ても `EEXIST` で同じ結果になるが、
 * それだと元の素材が消えている物を毎回「見つかりません」と言い続ける（ADR-0036 と同じ考え方）。
 * 同時に 2 回押されたときに起きる `EEXIST` も「もう入っている」と同じ扱いにする。
 */
const linkOne = async (deps: AssetFolderDeps, folder: string, entry: Entry): Promise<boolean> => {
  const target = inside(folder, join(folder, entry.name))
  if (await exists(target)) return false
  const source = await deps.storage.localPath(entry.asset.storageKey)
  try {
    await link(source, target)
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'EEXIST') {
      return false
    }
    throw error
  }
  return true
}

/**
 * その作品の素材を、まだ入っていないものだけフォルダへ入れる。
 * **1 つの失敗で止めない。** 入れられなかったものは理由を返し、ログにも残す。
 */
export const syncAssetFolder = async (
  deps: AssetFolderDeps,
  project: Project,
): Promise<AssetFolderResult> => {
  const folder = assetFolder(deps.rootDir, project)
  await mkdir(folder, { recursive: true })
  const shots = await deps.shots.findByProject(project.id)

  // Shot ごとに順に（同じ名前を同時に作らない。DB にも一度に大量の問い合わせをしない）。
  const outcomes = await sequentially(shots, async (shot) => {
    const entries = await entriesOf(deps, shot)
    const results = await sequentially(entries, async (entry) => {
      try {
        return { linked: await linkOne(deps, folder, entry), reason: null }
      } catch (error) {
        deps.logger.error({ shotId: shot.id, err: error }, '素材をフォルダへ入れられませんでした')
        return { linked: false, reason: reasonOf(error, entry.name) }
      }
    })
    return { shot, results }
  })

  return {
    folder,
    linked: outcomes.flatMap(({ results }) => results).filter((result) => result.linked).length,
    failed: outcomes.flatMap(({ shot, results }) =>
      results.flatMap((result) => (result.reason === null ? [] : [{ shotId: shot.id, reason: result.reason }])),
    ),
  }
}
