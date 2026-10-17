import { THUMBNAIL_MAX_BYTES } from '@ixa/domain'
import { renderStill, selectComposition } from '@remotion/renderer'
import { randomUUID } from 'node:crypto'
import { mkdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { bundleTimelineComposition } from './bundle-cache.js'
import { THUMBNAIL_COMPOSITION_ID } from './composition-id.js'
import type { RenderThumbnailStill } from './compositions/thumbnail-props.js'

/**
 * サムネイルの JPEG を 1 枚描く（ADR-0051）。画面の Player と同じ Thumbnail コンポジションを `renderStill` で描く。
 *
 * **2 MB 以上なら画質を下げて描き直す**（90 → 80 → 70）。それでも超えたら失敗にする（YouTube が受け付けない）。
 * 黙って大きいまま返さない。
 *
 * 例外の文に入力（`inputProps`）を入れない。署名付き URL が入っているため（ログにも DB にも残さない）。
 */

/** 試す画質の順。1280×720 の JPEG は 90 でもほぼ 1 MB を超えない。下げるのは保険。 */
export const THUMBNAIL_JPEG_QUALITIES: readonly number[] = Object.freeze([90, 80, 70])

export type StillSizeDecision =
  | { readonly kind: 'accept' }
  | { readonly kind: 'retry'; readonly jpegQuality: number }
  | { readonly kind: 'too_big' }

/** 描いた大きさから次の手を決める。**上限ちょうどは超えた扱い**（YouTube は「2 MB 未満」）。 */
export const decideStillSize = (
  bytes: number,
  triedQuality: number,
  qualities: readonly number[] = THUMBNAIL_JPEG_QUALITIES,
  maxBytes: number = THUMBNAIL_MAX_BYTES,
): StillSizeDecision => {
  if (bytes < maxBytes) return { kind: 'accept' }
  const next = qualities.find((quality) => quality < triedQuality)
  return next === undefined ? { kind: 'too_big' } : { kind: 'retry', jpegQuality: next }
}

/** 例外の文から URL を落とす。Remotion は読めなかった素材の URL を文に入れることがある。 */
export const withoutUrls = (message: string): string => message.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '（URL）')

const describe = (error: unknown): string => withoutUrls(error instanceof Error ? error.message : String(error))

const megabytes = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(2)

export const renderThumbnailStill: RenderThumbnailStill = async ({ props, outputDir }) => {
  const path = join(outputDir, `thumbnail-${randomUUID()}.jpg`)
  const firstQuality = THUMBNAIL_JPEG_QUALITIES[0] ?? 90
  let jpegQuality = firstQuality
  try {
    await mkdir(outputDir, { recursive: true })
    const serveUrl = await bundleTimelineComposition()
    const composition = await selectComposition({ serveUrl, id: THUMBNAIL_COMPOSITION_ID, inputProps: props })
    for (;;) {
      // 描くのは常に 0 コマ目。タイムラインのコマはコンポジションの中で <Freeze> している。
      await renderStill({
        composition,
        serveUrl,
        output: path,
        inputProps: props,
        frame: 0,
        imageFormat: 'jpeg',
        jpegQuality,
        overwrite: true,
      })
      const { size } = await stat(path)
      const decision = decideStillSize(size, jpegQuality)
      if (decision.kind === 'accept') return { path, bytes: size, jpegQuality }
      if (decision.kind === 'too_big') {
        throw new Error(
          `サムネイルが ${megabytes(size)} MB になり、画質を ${String(jpegQuality)} まで下げても 2 MB 未満にできませんでした`,
        )
      }
      jpegQuality = decision.jpegQuality
    }
  } catch (error) {
    await rm(path, { force: true })
    throw new Error(`サムネイルを描けませんでした（画質 ${String(jpegQuality)}）: ${describe(error)}`, { cause: error })
  }
}
