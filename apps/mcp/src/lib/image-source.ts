import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { seg, type ApiClient } from '../api-client.js'
import { ToolInputError } from '../tool-def.js'
import { WireStartFrame } from '../wire.js'
import { uploadLocalFile } from './media-io.js'

/**
 * 画像の出どころ。素材の ID・ある Shot の最初のコマ・手元のファイルのどれか 1 つ。
 * キャラクターの顔・場所の参考・最初のコマの差し替えが同じ形で受ける。
 */
export const ImageSource = z.object({
  mediaAssetId: z.string().ulid().optional().describe('An existing image media asset.'),
  fromShotStartFrame: z.string().ulid().optional().describe("Use this shot's current start frame."),
  imagePath: z
    .string()
    .min(1)
    .refine(isAbsolute, 'absolute path required')
    .optional()
    .describe('Absolute path of a local png/jpg/webp to upload.'),
})
export type ImageSource = z.infer<typeof ImageSource>

export const resolveImage = async (
  api: ApiClient,
  source: ImageSource,
  context: { readonly workspaceId: string; readonly projectId: string },
): Promise<string> => {
  const given = [source.mediaAssetId, source.fromShotStartFrame, source.imagePath].filter((v) => v !== undefined)
  if (given.length !== 1) {
    throw new ToolInputError('画像は mediaAssetId・fromShotStartFrame・imagePath のどれか 1 つで指定してください')
  }
  if (source.mediaAssetId !== undefined) return source.mediaAssetId
  if (source.fromShotStartFrame !== undefined) {
    const frame = await api.get(`/shots/${seg(source.fromShotStartFrame)}/start-frame`, WireStartFrame)
    if (frame.mediaAssetId === null) throw new ToolInputError('その Shot には最初のコマがありません')
    return frame.mediaAssetId
  }
  return uploadLocalFile(api, source.imagePath as string, { ...context, kind: 'image' })
}
