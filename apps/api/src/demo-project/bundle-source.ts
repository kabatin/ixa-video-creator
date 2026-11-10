import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { DemoManifest, type DemoFileRef } from '@ixa/domain'
import { DemoFileError, DemoManifestError } from './errors.js'

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

/** 上限を超えたら止めて投げる読み方（応答の大きさの申告を信用しない）。 */
const readCapped = async (body: ReadableStream<Uint8Array>, entry: DemoFileRef): Promise<Uint8Array> => {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > entry.sizeBytes) {
      await reader.cancel()
      throw new DemoFileError('broken', entry.file, '目録より大きい応答です')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

export type ReleaseBundleOptions = {
  /** 同梱の目録の場所（`apps/api/demo/manifest.json`）。 */
  readonly manifestPath: string
  /** 差し替え口（テスト）。既定は組み込みの fetch。 */
  readonly fetch?: typeof fetch
  readonly timeoutMs?: number
}

/**
 * 同梱の目録と、リリースに置いたファイル（`baseUrl + file`）。リダイレクトはたどる（リリースのファイルは
 * 署名付きの URL へ飛ばされる）。**飛ばされた先の URL は例外にもログにも入れない**（ファイル名だけ）。
 */
export const createReleaseBundleSource = (options: ReleaseBundleOptions): DemoBundleSource => {
  const fetchImpl = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? DEMO_FETCH_TIMEOUT_MS
  return {
    manifest: () => readManifestFile(options.manifestPath),
    fetchFile: async (manifest, entry) => {
      let response: Response
      try {
        response = await fetchImpl(new URL(entry.file, manifest.baseUrl), {
          redirect: 'follow',
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (error) {
        const timedOut = error instanceof Error && error.name === 'TimeoutError'
        // 元の例外は URL を含みうるので cause に付けない（名前だけ残す）。
        throw new DemoFileError('network', entry.file, timedOut ? '時間内に取れませんでした' : `つながりません（${error instanceof Error ? error.name : 'unknown'}）`)
      }
      if (!response.ok || response.body === null) {
        throw new DemoFileError('network', entry.file, `応答 ${String(response.status)}`)
      }
      // 飛ばされた先も https でなければ受けない（中身は sha256 で確かめるが、平文の経路を使わない）。
      if (response.url !== '' && !response.url.startsWith('https://')) {
        await response.body.cancel()
        throw new DemoFileError('network', entry.file, 'https でない先へ飛ばされました')
      }
      const declared = Number(response.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > entry.sizeBytes) {
        await response.body.cancel()
        throw new DemoFileError('broken', entry.file, '目録より大きい応答です')
      }
      return verifyFileBytes(entry, await readCapped(response.body, entry))
    },
  }
}
