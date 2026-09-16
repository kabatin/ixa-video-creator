import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * ジョブ専用の一時ディレクトリを作り、処理が終わったら必ず消す。
 *
 * ジョブごとにディレクトリを分けるのは、media キューを並列度 8 で回したときに
 * 同名の中間ファイル（proxy.mp4 / thumb.jpg）を取り違えないようにするため
 * （docs/ARCHITECTURE.md §20 の並列度表）。
 */
export const withTempDir = async <T>(
  parentDir: string,
  prefix: string,
  run: (dir: string) => Promise<T>,
): Promise<T> => {
  // mkdtemp は親ディレクトリが無いと失敗する。workDir はプロセス起動時に
  // 存在するとは限らないため、ここで作る。
  await mkdir(parentDir, { recursive: true })
  const dir = await mkdtemp(join(parentDir, prefix))

  try {
    return await run(dir)
  } finally {
    // 成功時も失敗時も消す。4K 素材の中間ファイルを残すとディスクを食い潰す。
    await rm(dir, { recursive: true, force: true })
  }
}
