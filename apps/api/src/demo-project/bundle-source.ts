import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { DemoManifest, type DemoFileRef } from '@ixa/domain'
import { DemoFileError, DemoManifestError } from './errors.js'
import { fetchReleaseFile } from './release-fetch.js'

/**
 * 見本の出どころ（ADR-0067）。目録と、目録が名前を挙げたファイルを渡す。2 つの実装がある。
 *
 * - 同梱（`createReleaseBundleSource`）: 目録は git の `apps/api/demo/manifest.json`、ファイルは https で取りに行く
 * - この機械のフォルダ（`createDirBundleSource`。`DEMO_DIR`）: 目録もファイルもフォルダから読む
 *
 * どちらも**大きさと sha256 を確かめてから**返す（確かめる前のものを、呼ぶ側は置き場に入れない）。
 */
export type DemoBundleSource = {
  /** 目録。無ければ null（見本はまだ無い）。読めない・形が合わなければ投げる。 */
  readonly manifest: () => Promise<DemoManifest | null>
  /** ファイルを取り、大きさと sha256 を確かめてから返す。合わなければ `DemoFileError`。 */
  readonly fetchFile: (manifest: DemoManifest, entry: DemoFileRef) => Promise<Uint8Array>
}

/** 見本が無い環境（テストの多く・配線していない環境）。 */
export const noDemoBundle: DemoBundleSource = {
  manifest: () => Promise.resolve(null),
  fetchFile: (_manifest, entry) => Promise.reject(new DemoFileError('missing', entry.file, '見本がありません')),
}

const errorCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined

export const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

/** 大きさと sha256 を目録と照らす。合わなければ投げる（名前だけ添える）。 */
export const verifyFileBytes = (entry: DemoFileRef, bytes: Uint8Array): Uint8Array => {
  if (bytes.byteLength !== entry.sizeBytes) {
    throw new DemoFileError('broken', entry.file, `大きさが目録と違います（目録 ${String(entry.sizeBytes)} / 実際 ${String(bytes.byteLength)}）`)
  }
  if (sha256Hex(bytes) !== entry.sha256) throw new DemoFileError('broken', entry.file, 'sha256 が目録と違います')
  return bytes
}

/** 目録のファイルを読む。無ければ null。形が合わなければ投げる（場所はこの機械のパスなので添える）。 */
export const readManifestFile = async (path: string): Promise<DemoManifest | null> => {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw new DemoManifestError(`見本の目録を読めませんでした（${path}）`, { cause: error })
  }
  try {
    return DemoManifest.parse(JSON.parse(text))
  } catch (error) {
    throw new DemoManifestError(`見本の目録の形が合いません（${path}）`, { cause: error })
  }
}

/** この機械のフォルダから読む（`DEMO_DIR`）。ファイル名は目録の形が縛っている（`/`・`..` を含まない）。 */
export const createDirBundleSource = (dir: string): DemoBundleSource => ({
  manifest: () => readManifestFile(join(dir, 'manifest.json')),
  fetchFile: async (_manifest, entry) => {
    const path = join(dir, entry.file)
    try {
      // 目録より大きいものは読み込まない（丸ごとメモリに載せるため）。
      const info = await stat(path)
      if (info.size > entry.sizeBytes) throw new DemoFileError('broken', entry.file, '目録より大きいファイルです')
      return verifyFileBytes(entry, await readFile(path))
    } catch (error) {
      if (error instanceof DemoFileError) throw error
      if (errorCode(error) === 'ENOENT') throw new DemoFileError('missing', entry.file, 'フォルダにありません', { cause: error })
      throw new DemoFileError('missing', entry.file, '読めませんでした', { cause: error })
    }
  },
})

/** ファイル 1 つを取りに行く時間の上限。見本のファイルは 1 つ数 MB。 */
export const DEMO_FETCH_TIMEOUT_MS = 120_000

export type ReleaseBundleOptions = {
  /** 同梱の目録の場所（`apps/api/demo/manifest.json`）。 */
  readonly manifestPath: string
  /** 差し替え口（テスト）。既定は組み込みの fetch。 */
  readonly fetch?: typeof fetch
  readonly timeoutMs?: number
}

/**
 * 同梱の目録と、リリースに置いたファイル（`baseUrl + file`）。取り方は `release-fetch.ts`
 * （リダイレクトは許したホストの https だけを自分でたどる。飛ばされた先の URL は例外にもログにも入れない）。
 */
export const createReleaseBundleSource = (options: ReleaseBundleOptions): DemoBundleSource => {
  const fetchImpl = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? DEMO_FETCH_TIMEOUT_MS
  return {
    manifest: () => readManifestFile(options.manifestPath),
    fetchFile: async (manifest, entry) =>
      verifyFileBytes(entry, await fetchReleaseFile(fetchImpl, manifest.baseUrl, entry, timeoutMs)),
  }
}
