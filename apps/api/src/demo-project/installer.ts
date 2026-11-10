import type { ProjectRepository } from '@ixa/db'
import {
  DUPLICATION_ITEMS,
  MediaAssetId as MediaAssetIdSchema,
  demoDefinedIds,
  newId,
  demoTotalBytes,
  remapExactValues,
  type DemoManifest,
  type Project,
  type WorkspaceId,
} from '@ixa/domain'
import type { Logger } from '../logger.js'
import type { ProjectDuplicationDeps } from '../project-duplication/deps.js'
import { writeSnapshot } from '../project-duplication/write-snapshot.js'
import { isUniqueViolation } from '../routes/unique-violation.js'
import { DemoFileError, DemoManifestError, DemoUnavailableError, DemoWorkspaceMissingError } from './errors.js'
import { checkAgainstLocalMedia, checkManifest, checkNarrationWiring } from './preflight.js'
import { installDemoMedia, type DemoMediaDeps } from './media.js'
import { withInstalledWaveforms } from './waveforms.js'
import { demoWriteDeps } from './write-deps.js'
import { parseDemoSource } from './source-wire.js'

/**
 * 同梱の見本の作品を入れる（ADR-0067）。押すだけで、曲・Shot・絵・採用した Take・テロップのある作品が開く。
 *
 * - 同じ印（`demoKey`）の生きている作品が作業場所にあれば、それを返して何も取りに行かない
 * - 同時に 2 回呼ばれても（2 度押し・画面と CLI）、**同じ約束を待たせて**作品は 1 つ（作業場所と印ごと）。
 *   最後の守りは部分一意索引で、ぶつかったら自分の作品を消し、先に入れた方を読み直して返す
 * - **印は全部書き終えてから付ける**（書きかけ・消し損ねた作品を「入っている」と読ませない）
 * - 書くのは作品の複製と同じ書き手（`writeSnapshot`）。途中で失敗したら作りかけの作品を消す
 *   （登録した素材は残す。中身の正しい、重ならない素材なので、次に入れるときに使い回す）
 */

export type DemoStatus = {
  readonly available: boolean
  readonly title: string | null
  /** 初めて入れるときに取りに行く大きさ（バイト）。 */
  readonly totalBytes: number | null
  /** この作業場所に入っている見本の作品。 */
  readonly project: Project | null
}

export type DemoInstallResult = { readonly project: Project; readonly created: boolean }

export type DemoInstaller = {
  readonly status: (workspaceId: WorkspaceId) => Promise<DemoStatus>
  /** 目録が無ければ `DemoUnavailableError`。取れない・壊れていれば `DemoFileError`、目録の形が合わなければ `DemoManifestError`。 */
  readonly install: (workspaceId: WorkspaceId) => Promise<DemoInstallResult>
}

export type DemoInstallerDeps = DemoMediaDeps & {
  /** 状態を読む口と、最後に見本の印を付ける口（全部書き終えてから付ける。書きかけを「入っている」と読ませない）。 */
  readonly projects: Pick<ProjectRepository, 'findByDemoKey' | 'setDemoKey' | 'workspaceExists'>
  /** 書き手が使う本物のリポジトリ（作品の複製と同じもの）。 */
  readonly writers: ProjectDuplicationDeps
  readonly logger: Logger
}

/** 目録の中で定めた ID（どこかの `id` の値）→ 新しい ID。 */
const freshIds = (canonical: Record<string, unknown>): ReadonlyMap<string, string> =>
  new Map(demoDefinedIds(canonical).map((id) => [id, newId(MediaAssetIdSchema)] as const))

/** 付け替えた後の中身を読む（付け替える前に `checkManifest` が同じ形を確かめている）。 */
const parseSource = (json: unknown) => {
  try {
    return parseDemoSource(json)
  } catch (error) {
    throw new DemoManifestError('見本の目録の中身を読めませんでした', { cause: error })
  }
}

const install = async (deps: DemoInstallerDeps, manifest: DemoManifest, workspaceId: WorkspaceId): Promise<DemoInstallResult> => {
  // 作業場所が無ければ、何も取りに行かない。
  if (!(await deps.projects.workspaceExists(workspaceId))) throw new DemoWorkspaceMissingError()
  const existing = await deps.projects.findByDemoKey(workspaceId, manifest.demoKey)
  if (existing !== null) return { project: existing, created: false }

  // 取りに行く前に確かめる（読めない・結び付きの閉じていない目録のために何 MB も取らない。preflight.ts）。
  const checked = checkManifest(manifest)
  checkNarrationWiring(checked.source, deps.writers)
  await checkAgainstLocalMedia(deps.mediaAssets, checked.canonical)
  const { ids, files } = await installDemoMedia(deps, manifest, workspaceId)
  // 素材の ID はこの機械の素材へ、目録の中で定めた ID はすべて新しい ID へ付け替えてから読む
  // （定めた ID がこの機械の行（消した素材も）の ID と同じでも、入れた作品の行はそれを指さない）。
  const source = parseSource(remapExactValues(checked.canonical, new Map([...freshIds(checked.canonical), ...ids])))
  // 作品は**頼んだ作業場所**に作る（目録を作った人の作業場所ではない）。
  const snapshot = { ...source, project: { ...source.project, workspaceId } }
  try {
    const writers = withInstalledWaveforms(demoWriteDeps(deps.writers, source.characterAssets), files, deps.storage)
    const written = await writeSnapshot(writers, snapshot, {
      name: manifest.title,
      items: new Set(DUPLICATION_ITEMS),
      // 印は最後に付ける。ぶつかったら（別の口が先に入れた）、書き手が自分の作品を消してから投げる。
      finish: (project) => deps.projects.setDemoKey(project.id, manifest.demoKey),
      failure: {
        error: '見本を入れられませんでした',
        log: '見本を入れる途中で失敗したので、作りかけの作品を消します',
        context: { demoKey: manifest.demoKey, workspaceId },
      },
    })
    return { project: written.project, created: true }
  } catch (error) {
    // 別の道（別の API の口など）が先に入れた。最後に印を付けるときに部分一意索引がぶつけたので（自分の作品は消してある）、そちらを返す。
    if (isUniqueViolation(error)) {
      const winner = await deps.projects.findByDemoKey(workspaceId, manifest.demoKey)
      if (winner !== null) return { project: winner, created: false }
    }
    throw error
  }
}

/** 入れる口を作る。**呼ぶたびに別の「入れている途中」の表を持つ**（配線で 1 回だけ作る。import しただけでは何も起きない）。 */
export const createDemoInstaller = (deps: DemoInstallerDeps): DemoInstaller => {
  const inFlight = new Map<string, Promise<DemoInstallResult>>()

  return {
    status: async (workspaceId) => {
      const manifest = await deps.bundle.manifest()
      if (manifest === null) return { available: false, title: null, totalBytes: null, project: null }
      return {
        available: true,
        title: manifest.title,
        totalBytes: demoTotalBytes(manifest),
        project: await deps.projects.findByDemoKey(workspaceId, manifest.demoKey),
      }
    },
    install: async (workspaceId) => {
      const manifest = await deps.bundle.manifest()
      if (manifest === null) throw new DemoUnavailableError()
      const key = `${workspaceId}:${manifest.demoKey}`
      const running = inFlight.get(key)
      if (running !== undefined) return running
      const started = install(deps, manifest, workspaceId)
        .catch((error: unknown) => {
          deps.logger.error(
            {
              err: error,
              demoKey: manifest.demoKey,
              workspaceId,
              ...(error instanceof DemoFileError ? { file: error.file, reason: error.reason } : {}),
            },
            '見本を入れられませんでした',
          )
          throw error
        })
        .finally(() => inFlight.delete(key))
      inFlight.set(key, started)
      return started
    },
  }
}
