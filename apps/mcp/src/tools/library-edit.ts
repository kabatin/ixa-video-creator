import { BrandCategory } from '@ixa/domain'
import { z } from 'zod'
import { seg, type ApiClient } from '../api-client.js'
import { ImageSource, resolveImage } from '../lib/image-source.js'
import { WireLocation } from '../wire.js'
import { defineTool, Id, jsonResult, mapLimited, ToolInputError } from '../tool-def.js'

/**
 * 場所とブランド資産（ロゴ・色・フォントなど）を直す・消す。
 * ID だけで別の作品のものを触らないよう、先に `projectId` の一覧にあるかを確かめる。
 */

const Deleted = z.unknown()

const WireBrandAsset = z.object({
  id: z.string(),
  category: z.string(),
  name: z.string(),
  mediaAssetId: z.string().nullable(),
  value: z.string().nullable(),
  usageRule: z.string().optional(),
})
type WireBrandAsset = z.infer<typeof WireBrandAsset>

const ensureListed = async <T extends { readonly id: string }>(
  api: ApiClient,
  path: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  id: string,
  message: string,
): Promise<T> => {
  const found = (await api.get(path, z.array(schema))).find((row) => row.id === id)
  if (found === undefined) throw new ToolInputError(message)
  return found
}

export const EditLocationInput = z.object({
  projectId: Id,
  locationId: Id,
  action: z.enum(['update', 'delete']),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).optional(),
  references: z.array(ImageSource).max(4).optional().describe('Replaces all reference images. [] clears them.'),
})

export const editLocationTool = defineTool({
  name: 'edit_location',
  risk: 'destructive',
  riskOf: (args) => (args.action === 'delete' ? 'destructive' : 'write'),
  description:
    'Rename a location, change its description or replace its reference images, or delete it ' +
    '(undoable from the edit history).',
  input: EditLocationInput,
  handler: async ({ projectId, locationId, action, references, ...fields }, { api, workspaceId }) => {
    await ensureListed(api, `/projects/${seg(projectId)}/locations`, WireLocation, locationId, 'その場所はこの作品のものではありません')
    if (action === 'delete') {
      await api.request('DELETE', `/locations/${seg(locationId)}`, Deleted)
      return jsonResult({ deleted: locationId })
    }
    const referenceAssetIds =
      references === undefined
        ? undefined
        : await mapLimited(references, 2, (source) => resolveImage(api, source, { workspaceId, projectId }))
    const patch = Object.fromEntries(
      Object.entries({ ...fields, referenceAssetIds }).filter(([, value]) => value !== undefined),
    )
    if (Object.keys(patch).length === 0) throw new ToolInputError('変える項目を 1 つ以上指定してください')
    const updated = await api.request('PATCH', `/locations/${seg(locationId)}`, WireLocation, { body: patch })
    return jsonResult({
      locationId: updated.id,
      name: updated.name,
      description: updated.description ?? '',
      referenceAssetIds: updated.referenceAssetIds ?? [],
    })
  },
})

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/

export const ManageBrandAssetsInput = z.object({
  projectId: Id,
  action: z.enum(['list', 'add', 'update', 'delete']),
  brandAssetId: Id.optional().describe('update / delete.'),
  category: BrandCategory.optional().describe('add (required) / update.'),
  name: z.string().min(1).max(200).optional().describe('add (required) / update. Japanese.'),
  image: ImageSource.optional().describe('The logo/uniform/texture image. Required for every category except color.'),
  value: z.string().regex(HEX_COLOR, '#RRGGBB').optional().describe('category=color: "#FFD200".'),
  usageRule: z.string().max(4000).optional().describe('How the brand must be used; brand review reads it.'),
})
type BrandArgs = z.infer<typeof ManageBrandAssetsInput>

const compactBrand = (b: WireBrandAsset) => ({
  id: b.id,
  category: b.category,
  name: b.name,
  ...(b.mediaAssetId === null ? {} : { mediaAssetId: b.mediaAssetId }),
  ...(b.value === null ? {} : { value: b.value }),
  ...(b.usageRule ? { usageRule: b.usageRule } : {}),
})

const brandPatch = async (args: BrandArgs, api: ApiClient, workspaceId: string) => {
  const mediaAssetId =
    args.image === undefined ? undefined : await resolveImage(api, args.image, { workspaceId, projectId: args.projectId })
  return Object.fromEntries(
    Object.entries({
      category: args.category,
      name: args.name,
      mediaAssetId,
      value: args.value,
      usageRule: args.usageRule,
    }).filter(([, value]) => value !== undefined),
  )
}

export const manageBrandAssetsTool = defineTool({
  name: 'manage_brand_assets',
  risk: 'destructive',
  riskOf: (args) => (args.action === 'list' ? 'read' : args.action === 'delete' ? 'destructive' : 'write'),
  description:
    'List, add, update or delete brand assets (logo, color, font, uniform, typography, texture, other). ' +
    'Images come from a media asset, a shot start frame or a local file; colors take value "#RRGGBB".',
  input: ManageBrandAssetsInput,
  handler: async (args, { api, workspaceId }) => {
    const listPath = `/projects/${seg(args.projectId)}/brand-assets`
    if (args.action === 'list') {
      return jsonResult({ brandAssets: (await api.get(listPath, z.array(WireBrandAsset))).map(compactBrand) })
    }
    if (args.action === 'add') {
      if (args.category === undefined || args.name === undefined) {
        throw new ToolInputError('add には category と name が要ります')
      }
      if (args.category === 'color' ? args.value === undefined : args.image === undefined) {
        throw new ToolInputError('color は value（#RRGGBB）、それ以外は image が要ります')
      }
      const created = await api.post(listPath, await brandPatch(args, api, workspaceId), WireBrandAsset)
      return jsonResult({ brandAsset: compactBrand(created) })
    }
    if (args.brandAssetId === undefined) throw new ToolInputError('brandAssetId を指定してください')
    await ensureListed(api, listPath, WireBrandAsset, args.brandAssetId, 'そのブランド資産はこの作品のものではありません')
    const path = `/brand-assets/${seg(args.brandAssetId)}`
    if (args.action === 'delete') {
      await api.request('DELETE', path, Deleted)
      return jsonResult({ deleted: args.brandAssetId })
    }
    const patch = await brandPatch(args, api, workspaceId)
    if (Object.keys(patch).length === 0) throw new ToolInputError('変える項目を 1 つ以上指定してください')
    const updated = await api.request('PATCH', path, WireBrandAsset, { body: patch })
    return jsonResult({ brandAsset: compactBrand(updated) })
  },
})
