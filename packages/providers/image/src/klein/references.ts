import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type { ImageGenerationRequest } from '@ixa/provider-core'
import {
  LOCAL_SERVER_MAX_IMAGE_BYTES,
  localServerInputError,
  type LocalServerImageMediaType,
} from '@ixa/provider-video'
import { KLEIN_IDENTITY } from './descriptor.js'

/** 送る参照 1 枚（klein-api の `image`）。 */
export type KleinReferenceImage = { readonly data: string; readonly media_type: LocalServerImageMediaType }

const MEDIA_TYPE_BY_EXTENSION: Readonly<Record<string, LocalServerImageMediaType>> = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
})

/**
 * 参照を手元のファイルから読み、base64 にする（worker は参照を手元へ落としてから渡す。ADR-0029）。
 * **形式と大きさはここで弾く。** サーバに 20MB を送ってから 422 で断られないように。
 * 文には置き場所（パス）を入れない。
 */
export const readKleinReferences = async (
  request: ImageGenerationRequest,
): Promise<readonly KleinReferenceImage[]> =>
  Promise.all(
    request.references.map(async ({ mediaAssetId }, index) => {
      const path = await request.resolveReference(mediaAssetId)
      const mediaType = MEDIA_TYPE_BY_EXTENSION[extname(path).toLowerCase()]
      if (mediaType === undefined) {
        throw localServerInputError(KLEIN_IDENTITY, `参照の画像 ${String(index + 1)} 枚目は PNG・JPEG・WebP ではありません`)
      }
      const body = await readFile(path)
      if (body.byteLength > LOCAL_SERVER_MAX_IMAGE_BYTES) {
        throw localServerInputError(KLEIN_IDENTITY, `参照の画像 ${String(index + 1)} 枚目が 20MB を超えています`)
      }
      return { data: body.toString('base64'), media_type: mediaType }
    }),
  )
