import { randomUUID } from 'node:crypto'
import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import type { MediaAssetRepository, RenderJobRepository, ThumbnailRepository } from '@ixa/db'
import {
  renderExportFileName,
  renderExportFolderName,
  subtitleCuesOf,
  toSrt,
  type Project,
  type RenderJob,
  type Thumbnail,
} from '@ixa/domain'
import { ObjectNotFoundError, type ObjectStorage } from '@ixa/storage'
import type { Logger } from '../logger.js'
import { sequentially } from '../sequentially.js'

/**
 * 書き出した動画を手元のフォルダに入れる（ADR-0036。制作者 2026-10-03「書き出し画面で生成された動画がある
 * フォルダを開く導線が欲しい」）。
 *
 * 書き出しの本体はストレージ（MinIO）にあり、Finder からは見えない。**フォルダを開くときに**、まだ入っていない
 * 動画をここで入れる。書く口はここ 1 つ（worker は書かない。名前の規則を 2 箇所に持たないため）。
 *
 * 書く先は `rootDir` の中だけ。名前は domain の `renderExportFolderName` / `renderExportFileName` が正で、
 * ここでも解決した場所が外に出ていないかを確かめる（規則が緩んでも外へ書かないための 2 重の柵）。
 */

/** 開く先。`file` なら Finder でそのファイルを選んだ状態にする。 */
export type OpenTarget = { readonly folder: string } | { readonly file: string }

export type FolderOpener = {
  /** この環境で Finder を開けるか（Mac だけ）。 */
  readonly canOpen: boolean
  readonly open: (target: OpenTarget) => Promise<void>
}

export type RenderFolderDeps = {
  readonly renderJobs: Pick<RenderJobRepository, 'findById' | 'findByProject'>
  readonly mediaAssets: Pick<MediaAssetRepository, 'findById'>
  /** 書き出したサムネイル（ADR-0051）。無ければ動画だけを入れる。 */
  readonly thumbnails?: Pick<ThumbnailRepository, 'findById' | 'findByProject'>
  readonly storage: Pick<ObjectStorage, 'get'>
  /** 書き出しフォルダの根（絶対パス。例: `~/Movies/ixa-video-creator`）。 */
  readonly rootDir: string
  /** 画面に出す場所でホームを `~` にするため。 */
  readonly homeDir: string
  /** ファイル名の日時を書く地域（この Mac の時刻）。 */
  readonly timeZone: string
  readonly opener: FolderOpener
  readonly logger: Logger
}

/** フォルダへ入れるものの ID。動画の書き出しかサムネイル（どちらも ULID なので混ざらない）。 */
export type ExportId = RenderJob['id'] | Thumbnail['id']

export type SyncFailure = { readonly id: ExportId; readonly reason: string }

export type SyncResult = {
  readonly folder: string
  readonly copied: number
  readonly failed: readonly SyncFailure[]
  /** フォルダに入っている動画・サムネイルの場所（書き出しごと）。入れられなかったものは無い。 */
  readonly files: ReadonlyMap<ExportId, string>
}

/** `parent` の中を指しているか。外を指していれば止める。**素材フォルダ（ADR-0041）も同じ門を通す。** */
export const inside = (parent: string, child: string): string => {
  const resolved = resolve(child)
  const rel = relative(resolve(parent), resolved)
  if (rel === '' || rel.startsWith('..') || rel.startsWith(sep)) {
    throw new Error(`書き出しフォルダの外を指しています: ${resolved}`)
  }
  return resolved
}

export const projectFolder = (rootDir: string, project: Pick<Project, 'name'>): string =>
  inside(rootDir, join(rootDir, renderExportFolderName(project.name)))

/** 画面に出す場所。ホームの下なら `~` にする。 */
export const displayLocation = (path: string, homeDir: string): string => {
  const rel = relative(resolve(homeDir), resolve(path))
  return rel.startsWith('..') || rel.startsWith(sep) ? path : `~/${rel}`
}

/** あるかどうか。**もうあるものは触らない**という判断に使う（素材フォルダも同じ）。 */
export const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * 途中で止まっても中途半端なファイルを残さない（`.part` に書いてから名前を変える）。
 * 一時ファイルの名前は毎回違うものにし、既にあれば書かない（`wx`）。同時に 2 回押されても互いの書きかけを壊さない。
 */
const writeAtomically = async (path: string, body: Uint8Array): Promise<void> => {
  const part = join(dirname(path), `.${randomUUID()}.part`)
  try {
    await writeFile(part, body, { flag: 'wx' })
    await rename(part, path)
  } catch (error) {
    await rm(part, { force: true })
    throw error
  }
}

const reasonOf = (error: unknown, what = '動画'): string =>
  error instanceof ObjectNotFoundError ? `元の${what}が見つかりません` : 'フォルダに書き込めませんでした'

type DoneJob = RenderJob & { readonly outputAssetId: NonNullable<RenderJob['outputAssetId']> }

/**
 * 字幕ファイル（SRT。ADR-0039）を動画と同じ名前で横に置く。中身は書き出したときのスナップショットのテロップ
 * （動画に出ている字と時刻）。テロップが無ければ置かない。動画と同じく、もう入っていれば書かない。
 */
const writeSubtitles = async (videoPath: string, job: DoneJob): Promise<void> => {
  const cues = subtitleCuesOf(job.timelineSnapshot.clips)
  if (cues.length === 0) return
  const path = `${videoPath.slice(0, videoPath.length - extname(videoPath).length)}.srt`
  if (await exists(path)) return
  await writeAtomically(path, new TextEncoder().encode(toSrt(cues)))
}

/**
 * 1 本をフォルダへ入れる。
 * - **もう入っていれば書かない。** 大きさが違っても上書きしない（`~/Movies` は利用者が触る場所。手を入れたものを消さない）
 * - 出力の素材が消されていれば飛ばす（`path: null`）。消したのは利用者なので、失敗として出し続けない
 * - テロップがあれば字幕ファイルも横に置く（前からある書き出しにも後から入る）
 */
const copyOne = async (
  deps: RenderFolderDeps,
  path: string,
  job: DoneJob,
): Promise<{ readonly path: string | null; readonly copied: boolean }> => {
  if (await exists(path)) {
    await writeSubtitles(path, job)
    return { path, copied: false }
  }
  const asset = await deps.mediaAssets.findById(job.outputAssetId)
  if (asset === null) return { path: null, copied: false }
  await writeAtomically(path, await deps.storage.get(asset.storageKey))
  await writeSubtitles(path, job)
  return { path, copied: true }
}

type Outcome = { readonly id: ExportId; readonly path: string | null; readonly copied: boolean; readonly reason: string | null }

/** 動画の書き出しを 1 本ずつ入れる（大きな動画をいくつも同時にメモリへ読まない）。 */
const syncVideos = async (deps: RenderFolderDeps, project: Project, folder: string): Promise<readonly Outcome[]> => {
  const done = (await deps.renderJobs.findByProject(project.id)).filter(
    (job): job is DoneJob => job.status === 'succeeded' && job.outputAssetId !== null,
  )
  return sequentially(done, async (job): Promise<Outcome> => {
    const name = renderExportFileName({
      projectName: project.name,
      createdAt: job.createdAt,
      preset: job.preset,
      scope: job.scope,
      timeZone: deps.timeZone,
    })
    try {
      return { id: job.id, ...(await copyOne(deps, inside(folder, join(folder, name)), job)), reason: null }
    } catch (error) {
      deps.logger.error({ renderJobId: job.id, err: error }, '書き出した動画をフォルダへ入れられませんでした')
      return { id: job.id, path: null, copied: false, reason: `「${name}」: ${reasonOf(error)}` }
    }
  })
}

type DoneThumbnail = Thumbnail & { readonly outputAssetId: NonNullable<Thumbnail['outputAssetId']> }

/**
 * 書き出したサムネイル（ADR-0051）を入れる。名前は頼んだときに決めた `fileName`。動画と同じく、
 * **もう入っていれば書かない**・素材が消されていれば飛ばす。
 */
const syncThumbnails = async (deps: RenderFolderDeps, project: Project, folder: string): Promise<readonly Outcome[]> => {
  if (deps.thumbnails === undefined) return []
  const done = (await deps.thumbnails.findByProject(project.id)).filter(
    (thumbnail): thumbnail is DoneThumbnail => thumbnail.status === 'done' && thumbnail.outputAssetId !== null,
  )
  return sequentially(done, async (thumbnail): Promise<Outcome> => {
    try {
      const path = inside(folder, join(folder, thumbnail.fileName))
      if (await exists(path)) return { id: thumbnail.id, path, copied: false, reason: null }
      const asset = await deps.mediaAssets.findById(thumbnail.outputAssetId)
      if (asset === null) return { id: thumbnail.id, path: null, copied: false, reason: null }
      await writeAtomically(path, await deps.storage.get(asset.storageKey))
      return { id: thumbnail.id, path, copied: true, reason: null }
    } catch (error) {
      deps.logger.error({ thumbnailId: thumbnail.id, err: error }, '書き出したサムネイルをフォルダへ入れられませんでした')
      return { id: thumbnail.id, path: null, copied: false, reason: `「${thumbnail.fileName}」: ${reasonOf(error, '画像')}` }
    }
  })
}

/**
 * そのプロジェクトの終わった書き出し（動画とサムネイル）を、まだ入っていないものだけフォルダへ入れる。
 * **1 本の失敗で全体を止めない。** 入れられなかったものは理由を返し、ログにも残す。
 */
export const syncRenderFolder = async (deps: RenderFolderDeps, project: Project): Promise<SyncResult> => {
  const folder = projectFolder(deps.rootDir, project)
  await mkdir(folder, { recursive: true })
  const outcomes = [...(await syncVideos(deps, project, folder)), ...(await syncThumbnails(deps, project, folder))]
  return {
    folder,
    copied: outcomes.filter((outcome) => outcome.copied).length,
    failed: outcomes.flatMap(({ id, reason }) => (reason === null ? [] : [{ id, reason }])),
    files: new Map(outcomes.flatMap(({ id, path }) => (path === null ? [] : [[id, path] as const]))),
  }
}
