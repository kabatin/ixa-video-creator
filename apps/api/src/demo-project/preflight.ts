import type { MediaAssetRepository } from '@ixa/db'
import { MediaAssetId as MediaAssetIdSchema, demoBindingProblems, demoDefinedIds, type DemoManifest } from '@ixa/domain'
import type { ProjectDuplicationDeps } from '../project-duplication/deps.js'
import { DemoManifestError } from './errors.js'
import { extensionOf } from './media.js'
import { parseDemoSource, serializeDemoSource, type DemoSource } from './source-wire.js'

/**
 * 目録を使う前の点検（ADR-0067）。入れる側は取りに行く前に、書き出す側は書く前に同じ点検を通す
 * （書き出したものが入れる側で断られる、を書き出しの時点で止める）。
 */

/** 挙げる場所の数の上限。 */
const MAX_PATHS = 10

const listed = (paths: readonly string[]): string =>
  `${paths.slice(0, MAX_PATHS).join('、')}${paths.length > MAX_PATHS ? ` ほか ${String(paths.length - MAX_PATHS)} 件` : ''}`

/** 点検を通った目録の中身。`canonical` は読んだ後の形を JSON に戻したもの（形に無い枝は落ちている）。 */
export type CheckedSource = { readonly source: DemoSource; readonly canonical: Record<string, unknown> }

/**
 * 目録だけで決まる点検: 素材の拡張子と型・中身がこの版の形で読めるか・目録の中の結び付き（`demoBindingProblems`）。
 * **結び付きは読んだ後の中身で数える**（形に無い枝の `{ "id": X }` で ID を定めさせない）。
 * 合わなければ `DemoManifestError`（場所を添える。値は添えない）。
 */
export const checkManifest = (manifest: DemoManifest): CheckedSource => {
  for (const entry of manifest.media) extensionOf(entry)
  let source: DemoSource
  try {
    source = parseDemoSource(manifest.source)
  } catch (error) {
    throw new DemoManifestError('見本の目録の中身を読めませんでした', { cause: error })
  }
  const canonical = serializeDemoSource(source)
  const problems = demoBindingProblems({ ...manifest, source: canonical })
  if (problems.length > 0) {
    throw new DemoManifestError(`見本の目録の中で、目録の外を指す値が ${String(problems.length)} 件あります: ${listed(problems)}`)
  }
  return { source, canonical }
}

/**
 * 目録の中で定めた ID が、この機械の生きている素材に当たらないか（守りを重ねる。入れる側は定めた ID を
 * 新しい ID に付け替えるので、当たっても行はその素材を指さない。消した素材は表に出ないのでここでは見えない）。
 */
export const checkAgainstLocalMedia = async (
  mediaAssets: Pick<MediaAssetRepository, 'findById'>,
  canonical: Record<string, unknown>,
): Promise<void> => {
  const ids = demoDefinedIds(canonical)
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
