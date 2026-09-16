import { writeFile } from 'node:fs/promises'
import { extname, join, relative, sep } from 'node:path'
import type { MediaAsset } from '@ixa/domain'
import type { ObjectStorage } from '@ixa/storage'

/**
 * 解析対象の音源を `apps/audio` が読める場所へ置く。
 *
 * **HTTP に音声を乗せない。** `apps/audio` の `/analyze` はパスだけを受け取り、
 * `AUDIO_ROOT` 配下に閉じ込めて解決する（`apps/audio/src/paths.py`）。
 * そのため worker 側は共有ディレクトリへ実体を書き出し、
 * `AUDIO_ROOT` からの**相対パス**を渡す。
 * 絶対パスを渡さないのは、worker と audio サービスで同じディレクトリが
 * 別のパスに見える構成（コンテナ等）でも壊れないようにするため。
 */

/** 拡張子が読み取れないときのフォールバック。librosa は拡張子から形式を推定する。 */
const FALLBACK_EXTENSION = '.bin'

/** ストレージ上の原本の拡張子を引き継いだファイル名。 */
export const audioFileName = (asset: MediaAsset): string => {
  const ext = extname(asset.storageKey)
  return `audio${ext === '' ? FALLBACK_EXTENSION : ext}`
}

/**
 * 原本をダウンロードして `audioRoot` 配下へ書き出し、`audioRoot` からの相対パスを返す。
 * `jobDir` は `audioRoot` の下にある前提（呼び出し側が withTempDir で掘る）。
 */
export const placeAudioForAnalysis = async (
  storage: ObjectStorage,
  asset: MediaAsset,
  audioRoot: string,
  jobDir: string,
): Promise<string> => {
  const absolutePath = join(jobDir, audioFileName(asset))
  const relativePath = relative(audioRoot, absolutePath)

  // 相対パスが `..` を含むと apps/audio 側が必ず 400 で弾く。
  // ここで気付かないと「解析サービスの不具合」に見えてしまうため、先に落とす。
  if (relativePath === '' || relativePath.split(sep).includes('..')) {
    throw new Error(
      `解析用の一時ディレクトリが AUDIO_ROOT の外にあります: audioRoot=${audioRoot} jobDir=${jobDir}`,
    )
  }

  await writeFile(absolutePath, await storage.get(asset.storageKey))

  // POSIX 区切りへ正規化する。受け取る apps/audio は Python の Path で解釈する。
  return relativePath.split(sep).join('/')
}
