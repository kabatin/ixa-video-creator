import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { contentTypeForKey } from './content-type.js'
import { signStorageAccess, type StorageAccessMethod } from './file-signature.js'
import type { ObjectHead, ObjectStorage, StorageKey } from './port.js'
import { ObjectNotFoundError, StorageError } from './port.js'
import { signingWindow } from './signing-window.js'
import {
  assertValidStorageKey,
  InvalidStorageKeyError,
  isInsideRoot,
  resolveStoragePath,
} from './storage-path.js'

/**
 * 手元のファイルを保管庫にする ObjectStorage 実装（ADR-0041）。
 *
 * 置き場所は storageKey そのまま（`<根>/media/<workspaceId>/<mediaAssetId>/original.mp4`）。
 * Finder で開ける・Time Machine に乗ることが、この実装を選ぶ理由なので、
 * **付き添いのメタデータのファイルを並べない**（Content-Type は拡張子から決める。content-type.ts）。
 *
 * 署名付き URL は API が出す。`publicBaseUrl` の下にこのルートがある前提で組み立てる。
 */

/** 配信ルートの位置。**API 側はこの定数を読んで登録する**（2 箇所に書くとズレる）。 */
export const STORAGE_FILE_ROUTE_PREFIX = '/files'

export type FsStorageConfig = {
  /** 保管庫の根（絶対パス）。 */
  readonly root: string
  /** 署名付き URL の宛先（例: `http://127.0.0.1:3001`）。末尾の `/` は付けても付けなくてもよい。 */
  readonly publicBaseUrl: string
  /** 署名の鍵。32 文字以上（file-signature.ts が確かめる）。 */
  readonly signingSecret: string
  /** いまの時刻。テストから差し替えるために受ける。既定は `Date.now`。 */
  readonly nowMs?: () => number
}

/**
 * fs ドライバだけが持つ口。
 *
 * 配信ルートは流し読み（`createReadStream`）で返したいので、実体の場所を知る必要がある。
 * **port（`ObjectStorage`）は広げない**。S3 ドライバのときは署名を S3 が出し、配信ルートも登録しないため。
 */
export type FsStorage = ObjectStorage & {
  /**
   * key に対応する実体の場所を返す。
   * 無ければ `ObjectNotFoundError`、形が不正なら `InvalidStorageKeyError`。
   * **シンボリックリンクを解いてから根の中かを確かめる**（根の中に外へ向かうリンクを置かれても出ない）。
   */
  localPath(key: StorageKey): Promise<string>
}

const isErrnoException = (error: unknown, code: string): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === code

export const createFsStorage = (config: FsStorageConfig): FsStorage => {
  const configuredRoot = path.resolve(config.root)
  const now = config.nowMs ?? ((): number => Date.now())
  const baseUrl = config.publicBaseUrl.replace(/\/+$/, '')

  /**
   * 根の実体の場所。**シンボリックリンクを解いた形で 1 度だけ決める。**
   *
   * 解かないまま「根の中か」を比べると、途中に 1 つでもリンクがあるだけで全部外に見える
   * （macOS の `/var` は `/private/var` へのリンク）。無ければここで作る
   * （初回に手で mkdir させない。import しただけでは走らない）。
   */
  let resolvedRoot: string | null = null
  const rootPath = async (): Promise<string> => {
    if (resolvedRoot === null) {
      await fs.mkdir(configuredRoot, { recursive: true })
      resolvedRoot = await fs.realpath(configuredRoot)
    }
    return resolvedRoot
  }

  const pathFor = async (key: StorageKey): Promise<string> => resolveStoragePath(await rootPath(), key)

  /** 実体を触る直前の確認。シンボリックリンクを解いた先が根の外なら受けない。 */
  const realPathInsideRoot = async (target: string, key: StorageKey): Promise<string> => {
    const real = await fs.realpath(target)
    if (!isInsideRoot(await rootPath(), real)) {
      throw new InvalidStorageKeyError(key, 'リンクの先が根の外です')
    }
    return real
  }

  /**
   * contentType は受け取らない（port は渡してくるが、この実装は保存しない）。
   * 読むときに拡張子から決め直す。理由は content-type.ts に書いた。
   */
  const put = async (key: StorageKey, body: Uint8Array | Buffer): Promise<void> => {
    const target = await pathFor(key)
    const dir = path.dirname(target)
    // 途中のファイルを残さないため、別の名前に書いてから名前を変える（ADR-0036 と同じ）。
    const temp = `${target}.${randomUUID()}.part`
    try {
      await fs.mkdir(dir, { recursive: true })
      await realPathInsideRoot(dir, key)
      await fs.writeFile(temp, body)
      await fs.rename(temp, target)
    } catch (error) {
      // 書きかけを残さない。消せなくても元のエラーを優先して伝える。
      await fs.rm(temp, { force: true }).catch(() => undefined)
      if (error instanceof InvalidStorageKeyError) throw error
      throw new StorageError('書き込みに失敗しました', 'put', key, { cause: error })
    }
  }

  const get = async (key: StorageKey): Promise<Uint8Array> => {
    const target = await pathFor(key)
    try {
      const real = await realPathInsideRoot(target, key)
      return new Uint8Array(await fs.readFile(real))
    } catch (error) {
      if (error instanceof InvalidStorageKeyError) throw error
      if (isErrnoException(error, 'ENOENT')) throw new ObjectNotFoundError(key, { cause: error })
      throw new StorageError('読み込みに失敗しました', 'get', key, { cause: error })
    }
  }

  const head = async (key: StorageKey): Promise<ObjectHead | null> => {
    const target = await pathFor(key)
    try {
      const stat = await fs.stat(target)
      // フォルダは「無い」と同じ扱い。MinIO の置き方（キーがフォルダ）を引きずらない。
      if (!stat.isFile()) return null
      return {
        key,
        bytes: stat.size,
        contentType: contentTypeForKey(key),
        lastModified: stat.mtime,
      }
    } catch (error) {
      if (isErrnoException(error, 'ENOENT')) return null
      throw new StorageError('メタデータの取得に失敗しました', 'head', key, { cause: error })
    }
  }

  /** 無いものを消そうとしても成功とする（S3 と同じ振る舞い）。 */
  const del = async (key: StorageKey): Promise<void> => {
    const target = await pathFor(key)
    try {
      await fs.rm(target, { force: true })
    } catch (error) {
      throw new StorageError('削除に失敗しました', 'delete', key, { cause: error })
    }
  }

  const exists = async (key: StorageKey): Promise<boolean> => (await head(key)) !== null

  /**
   * 署名付き URL。**時刻は窓の頭に揃える**（signing-window.ts）。
   * 揃えないと同じ物でも頼むたびに URL が変わり、プレビューが毎回読み直す（2026-10-02 の件）。
   */
  const signedUrl = (
    method: StorageAccessMethod,
    key: StorageKey,
    expiresInSec: number,
    contentType?: string,
  ): string => {
    const window = signingWindow(now(), expiresInSec)
    const expiresAtSec = Math.floor(window.signingDate.getTime() / 1000) + window.expiresInSec
    const access = {
      method,
      key,
      expiresAtSec,
      ...(contentType === undefined ? {} : { contentType }),
    }
    const signature = signStorageAccess(access, config.signingSecret)
    const query = new URLSearchParams({ exp: String(expiresAtSec), sig: signature })
    if (contentType !== undefined) query.set('ct', contentType)
    const encodedKey = key
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')
    return `${baseUrl}${STORAGE_FILE_ROUTE_PREFIX}/${encodedKey}?${query.toString()}`
  }

  /**
   * 署名は計算だけで済むが、port が Promise を返す口なので async のままにする。
   * **`Promise.resolve` に替えない。** 形が不正な key を同期で throw すると、
   * 呼び出し側の `await` より手前で飛び、失敗の扱いが他の口と変わってしまう。
   */
  /* eslint-disable @typescript-eslint/require-await -- 上のコメントの通り */
  const signedPutUrl = async (
    key: StorageKey,
    contentType: string,
    expiresInSec: number,
  ): Promise<string> => {
    assertValidStorageKey(key)
    return signedUrl('PUT', key, expiresInSec, contentType)
  }

  const signedGetUrl = async (key: StorageKey, expiresInSec: number): Promise<string> => {
    assertValidStorageKey(key)
    return signedUrl('GET', key, expiresInSec)
  }
  /* eslint-enable @typescript-eslint/require-await */

  const localPath = async (key: StorageKey): Promise<string> => {
    const target = await pathFor(key)
    try {
      const real = await realPathInsideRoot(target, key)
      const stat = await fs.stat(real)
      if (!stat.isFile()) throw new ObjectNotFoundError(key)
      return real
    } catch (error) {
      if (error instanceof InvalidStorageKeyError || error instanceof ObjectNotFoundError) throw error
      if (isErrnoException(error, 'ENOENT')) throw new ObjectNotFoundError(key, { cause: error })
      throw new StorageError('場所の解決に失敗しました', 'get', key, { cause: error })
    }
  }

  return { put, get, head, delete: del, exists, signedPutUrl, signedGetUrl, localPath }
}
