import type { MediaAssetRepository } from '@ixa/db'
import { MediaAssetId as MediaAssetIdSchema, demoBindingProblems, demoDefinedIds, type DemoManifest } from '@ixa/domain'
import type { ProjectDuplicationDeps } from '../project-duplication/deps.js'
import { DemoManifestError } from './errors.js'
import { extensionOf } from './media.js'
import { parseDemoSource, type DemoSource } from './source-wire.js'

/**
 * 目録を使う前の点検（ADR-0067）。入れる側は取りに行く前に、書き出す側は書く前に同じ点検を通す
 * （書き出したものが入れる側で断られる、を書き出しの時点で止める）。
 */

/** 挙げる場所の数の上限。 */
const MAX_PATHS = 10

const listed = (paths: readonly string[]): string =>
  `${paths.slice(0, MAX_PATHS).join('、')}${paths.length > MAX_PATHS ? ` ほか ${String(paths.length - MAX_PATHS)} 件` : ''}`

/**
 * 目録だけで決まる点検: 素材の拡張子と型・目録の中の結び付き（`demoBindingProblems`）・中身がこの版の形で読めるか。
 * 合わなければ `DemoManifestError`（場所を添える。値は添えない）。読んだ中身を返す。
 */
export const checkManifest = (manifest: DemoManifest): DemoSource => {
  for (const entry of manifest.media) extensionOf(entry)
  const problems = demoBindingProblems(manifest)
  if (problems.length > 0) {
    throw new DemoManifestError(`見本の目録の中で、目録の外を指す値が ${String(problems.length)} 件あります: ${listed(problems)}`)
  }
  try {
    return parseDemoSource(manifest.source)
  } catch (error) {
    throw new DemoManifestError('見本の目録の中身を読めませんでした', { cause: error })
  }
}

/** 目録の中で定めた ID が、この機械の素材に当たらないか（当たれば、付け替えの外で素材として引かれる）。 */
export const checkAgainstLocalMedia = async (
  mediaAssets: Pick<MediaAssetRepository, 'findById'>,
  manifest: DemoManifest,
): Promise<void> => {
  const ids = demoDefinedIds(manifest.source)
  const found = await Promise.all(ids.map((id) => mediaAssets.findById(MediaAssetIdSchema.parse(id))))
  const clashes = found.filter((asset) => asset !== null).length
  if (clashes > 0) throw new DemoManifestError(`見本の目録の中の ID が、この機械の素材と ${String(clashes)} 件重なっています`)
}

/** 目録に声・ナレーションがあるのに、書く口が繋がっていなければ止める（黙って落とさない）。 */
export const checkNarrationWiring = (source: DemoSource, writers: ProjectDuplicationDeps): void => {
  const needs = source.voices.length > 0 || source.narrationLines.length > 0 || source.narrationTakes.length > 0
  if (needs && (writers.voices === undefined || writers.narrationLines === undefined || writers.narrationTakes === undefined)) {
    throw new Error('見本に声とナレーションがあるのに、声とナレーションを書く口が繋がっていません')
  }
}
