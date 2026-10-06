import { randomUUID } from 'node:crypto'
import { mkdir, open, readdir, rename, rm, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { pumpWithLimit } from './stream.js'

/**
 * 出来た動画を手元に置く（ADR-0031 / 0040）。
 *
 * **出力は必ずローカルのファイルとして返す。** 手元の生成サーバは 127.0.0.1 で待ち受けるので、
 * 出力 URL をそのまま `{ type: 'remote' }` で返すと worker の SSRF 検査（ループバック拒否）に
 * 正しく止められる。検査を緩めるのではなく、Provider が自分で取りに行ってファイルにする
 * （`ProviderOutput` を型で分けている理由そのもの）。
 */

/**
 * 生成は止めないが黙って捨てない失敗を知らせる口（PR #4 レビュー #5、規約 5）。pino の `warn` と同じ形。
 * Provider は logger を持たないので、配線が渡す。
 */
export type LocalServerWarn = (detail: Readonly<Record<string, unknown>>, message: string) => void

/** 配線が口を渡さないとき（テストなど）。 */
export const IGNORE_LOCAL_SERVER_WARNING: LocalServerWarn = () => undefined

const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'

/** 書きかけのファイルを置く場所。最終の名前と同じファイルシステムに置く（rename を原子的にするため）。 */
export const LOCAL_SERVER_TMP_DIR = '.tmp'
/** 投入時の記録（`submit-note.ts`）を置く場所。 */
export const LOCAL_SERVER_NOTES_DIR = '.jobs'

/**
 * これより古いファイルは消してよい。worker は完了を見た回に取り込むので、
 * ここに残るのは取り込み済みの抜け殻か、中断した書きかけだけ。
 * ポーリングの上限（約 2 時間）より十分長く取る。
 */
export const LOCAL_SERVER_OUTPUT_RETENTION_MS = 24 * 60 * 60 * 1000

/**
 * 出力 1 本の上限。243 コマの 1080p でも数十 MB なので、桁違いに大きいものは何かがおかしい。
 * 上限なしに書き続けると、壊れたサーバがディスクを埋める。
 */
export const LOCAL_SERVER_MAX_OUTPUT_BYTES = 2 * 1024 * 1024 * 1024

export const localServerOutputPath = (outputDir: string, jobId: string): string =>
  join(outputDir, `${jobId}.mp4`)

/** 最終の名前で中身のあるファイルがあるか。あれば取りに行かない（同じジョブを 2 度落とさない）。 */
export const hasSavedOutput = async (path: string): Promise<boolean> => {
  try {
    const info = await stat(path)
    return info.isFile() && info.size > 0
  } catch {
    return false
  }
}

/** 本文が空だった。書きかけを残さず、呼び出し側が理由を付けて返す。 */
export class EmptyOutputError extends Error {
  override readonly name = 'EmptyOutputError'
}

/** 本文をファイルへ流す。読み・書きのどちらで失敗しても読み取りは取り消される（`pumpWithLimit`）。 */
const writeStream = async (
  path: string,
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<number> => {
  const handle = await open(path, 'wx')
  try {
    return await pumpWithLimit(body, maxBytes, async (chunk) => {
      await handle.write(chunk)
    })
  } finally {
    await handle.close()
  }
}

/**
 * 応答本文を書きかけの名前へ流し込み、**書き終えてから**最終の名前へ移す。
 *
 * - メモリに丸ごと載せない（243 コマの 1080p でも数十 MB。32GB の機械で生成と同居する）
 * - 途中で落ちても、最終の名前には半端なファイルが現れない
 * - 上限（`LOCAL_SERVER_MAX_OUTPUT_BYTES`）を超えたら止める
 * - 失敗したら書きかけを消してから投げ直す（握り潰さない）
 */
export const saveOutputAtomically = async (
  outputDir: string,
  jobId: string,
  body: ReadableStream<Uint8Array>,
  maxBytes: number = LOCAL_SERVER_MAX_OUTPUT_BYTES,
): Promise<{ readonly path: string; readonly bytes: number }> => {
  const tmpDir = join(outputDir, LOCAL_SERVER_TMP_DIR)
  await mkdir(tmpDir, { recursive: true })
  const partPath = join(tmpDir, `${jobId}.${randomUUID()}.part`)
  const finalPath = localServerOutputPath(outputDir, jobId)

  try {
    const bytes = await writeStream(partPath, body, maxBytes)
    if (bytes === 0) throw new EmptyOutputError('出力の本文が空でした')
    await rename(partPath, finalPath)
    return { path: finalPath, bytes }
  } catch (error) {
    await rm(partPath, { force: true })
    throw error
  }
}

/** 消してよいのは自分が作った形のファイルだけ。同じ場所に置かれた別のものに触れない。 */
const OWN_FILE = /\.(?:mp4|part|json)$/

const pruneDir = async (dir: string, cutoffMs: number, warn: LocalServerWarn): Promise<number> => {
  const names = await readdir(dir).catch((error: unknown) => {
    // まだ作っていない置き場は失敗ではない。
    if (!isMissing(error)) warn({ err: error, dir }, '手元の生成サーバの出力の置き場を読めず、古いファイルを消せませんでした')
    return [] as string[]
  })
  const removed = await Promise.all(
    names
      .filter((name) => OWN_FILE.test(name))
      .map(async (name): Promise<number> => {
        const path = join(dir, name)
        try {
          const info = await stat(path)
          if (!info.isFile() || info.mtimeMs >= cutoffMs) return 0
          await unlink(path)
          return 1
        } catch (error) {
          // 消せなかったものは次の回に回す。掃除のせいで投入を止めない。ほかの回が先に消したなら失敗ではない。
          if (!isMissing(error)) {
            warn({ err: error, file: name }, '手元の生成サーバの古い出力を消せませんでした。続くとディスクが増え続けます')
          }
          return 0
        }
      }),
  )
  return removed.reduce((sum, n) => sum + n, 0)
}

/**
 * 古い出力・書きかけ・投入の記録を消す。**投げない**（掃除は付け足しで、失敗しても生成は進める）。
 * 消した数を返す（テストと記録のため）。
 */
export const pruneLocalServerOutputs = async (
  outputDir: string,
  now: number = Date.now(),
  retentionMs: number = LOCAL_SERVER_OUTPUT_RETENTION_MS,
  warn: LocalServerWarn = IGNORE_LOCAL_SERVER_WARNING,
): Promise<number> => {
  const cutoffMs = now - retentionMs
  const counts = await Promise.all(
    [outputDir, join(outputDir, LOCAL_SERVER_TMP_DIR), join(outputDir, LOCAL_SERVER_NOTES_DIR)].map((dir) =>
      pruneDir(dir, cutoffMs, warn),
    ),
  )
  return counts.reduce((sum, n) => sum + n, 0)
}
