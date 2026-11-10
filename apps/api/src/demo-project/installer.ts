import type { ProjectRepository } from '@ixa/db'
import {
  DUPLICATION_ITEMS,
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
import { DemoFileError, DemoManifestError, DemoUnavailableError } from './errors.js'
import { installDemoMedia, type DemoMediaDeps } from './media.js'
import { demoWriteDeps } from './write-deps.js'
import { parseDemoSource } from './source-wire.js'

/**
 * 同梱の見本の作品を入れる（ADR-0067）。押すだけで、曲・Shot・絵・採用した Take・テロップのある作品が開く。
 *
 * - 同じ印（`demoKey`）の生きている作品が作業場所にあれば、それを返して何も取りに行かない
 * - 同時に 2 回呼ばれても（2 度押し・画面と CLI）、**同じ約束を待たせて**作品は 1 つ（作業場所と印ごと）。
 *   最後の守りは部分一意索引で、ぶつかったら作った方を読み直して返す
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
  readonly projects: Pick<ProjectRepository, 'findByDemoKey'>
  /** 書き手が使う本物のリポジトリ（作品の複製と同じもの）。 */
  readonly writers: ProjectDuplicationDeps
  readonly logger: Logger
}

/** 目録の中身を読む。合わなければ目録の失敗として投げる。 */
const parseSource = (json: unknown) => {
  try {
    return parseDemoSource(json)
  } catch (error) {
    throw new DemoManifestError('見本の目録の中身を読めませんでした', { cause: error })
  }
}

const install = async (deps: DemoInstallerDeps, manifest: DemoManifest, workspaceId: WorkspaceId): Promise<DemoInstallResult> => {
  const existing = await deps.projects.findByDemoKey(workspaceId, manifest.demoKey)
  if (existing !== null) return { project: existing, created: false }

  // 取りに行く前に、中身がこの版の形で読めることを確かめる（読めない目録のために何 MB も取らない）。
  parseSource(manifest.source)
  const { ids } = await installDemoMedia(deps, manifest, workspaceId)
  const source = parseSource(remapExactValues(manifest.source, ids))
  // 作品は**頼んだ作業場所**に作る（目録を作った人の作業場所ではない）。
  const snapshot = { ...source, project: { ...source.project, workspaceId } }
  try {
    const written = await writeSnapshot(demoWriteDeps(deps.writers, source.characterAssets), snapshot, {
      name: manifest.title,
      items: new Set(DUPLICATION_ITEMS),
      demoKey: manifest.demoKey,
      failure: {
        error: '見本を入れられませんでした',
        log: '見本を入れる途中で失敗したので、作りかけの作品を消します',
        context: { demoKey: manifest.demoKey, workspaceId },
      },
    })
    return { project: written.project, created: true }
  } catch (error) {
    // 別の道（別の API の口など）が先に作った。部分一意索引がぶつけたので、そちらを返す。
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
