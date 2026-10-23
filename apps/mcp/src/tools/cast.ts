import { IdentityImageRole } from '@ixa/domain'
import { z } from 'zod'
import { seg } from '../api-client.js'
import { ImageSource, resolveImage } from '../lib/image-source.js'
import { WireCharacter, WireLocation, WireLook } from '../wire.js'
import { defineTool, Id, jsonResult, mapLimited } from '../tool-def.js'

/** 登場人物と場所。顔・場所の参考画像を付けると、最初のコマと動画がそれに寄る。 */

const WireIdentityImage = z.object({ id: z.string(), mediaAssetId: z.string(), role: z.string() })

export const CreateCharacterInput = z.object({
  projectId: Id,
  name: z.string().min(1).max(100).describe('Short internal name (e.g. "hero"). Shown in the UI too.'),
  displayName: z.string().min(1).max(200).optional().describe('Name shown to the user (Japanese). Defaults to name.'),
  description: z.string().max(4000).optional().describe('Appearance and personality (Japanese).'),
  identityAnchors: z
    .array(z.string().min(1).max(200))
    .max(20)
    .optional()
    .describe('Short visual traits always put into prompts, e.g. "silver short hair", "red scarf".'),
  styleTokens: z.array(z.string().min(1).max(200)).max(20).optional(),
  identityImage: ImageSource.extend({ role: IdentityImageRole.default('face_front') })
    .optional()
    .describe('Reference image of the character (face or full body).'),
})

export const createCharacterTool = defineTool({
  name: 'create_character',
  risk: 'write',
  description:
    'Create a character (a default Look is created automatically) and optionally attach an identity image from ' +
    'a media asset, a shot start frame or a local file. Use the returned characterId in edit_shots cast.',
  input: CreateCharacterInput,
  handler: async (args, { api, workspaceId }) => {
    // 画像は作る前に確かめる（別の作品の素材なら、キャラクターだけが残らないよう何も作らずに断る）。
    const identity =
      args.identityImage === undefined
        ? null
        : {
            mediaAssetId: await resolveImage(api, args.identityImage, { workspaceId, projectId: args.projectId }),
            role: args.identityImage.role,
          }
    const character = await api.post(
      `/projects/${seg(args.projectId)}/characters`,
      {
        name: args.name,
        displayName: args.displayName ?? args.name,
        ...(args.description === undefined ? {} : { description: args.description }),
        ...(args.identityAnchors === undefined ? {} : { identityAnchors: args.identityAnchors }),
        ...(args.styleTokens === undefined ? {} : { styleTokens: args.styleTokens }),
      },
      WireCharacter,
    )
    const image =
      identity === null
        ? null
        : await api.post(
            `/characters/${seg(character.id)}/identity-images`,
            {
              ...identity,
              isPrimary: true,
              order: 0,
            },
            WireIdentityImage,
          )
    const looks = await api.get(`/characters/${seg(character.id)}/looks`, z.array(WireLook))
    return jsonResult({
      characterId: character.id,
      name: character.name,
      displayName: character.displayName,
      looks: looks.map((l) => ({ id: l.id, name: l.name, isDefault: l.isDefault ?? false })),
      ...(image === null ? {} : { identityImage: { mediaAssetId: image.mediaAssetId, role: image.role } }),
    })
  },
})

export const CreateLocationInput = z.object({
  projectId: Id,
  name: z.string().min(1).max(200).describe('Location name shown to the user (Japanese).'),
  description: z.string().max(4000).optional().describe('What the place looks like (Japanese).'),
  references: z.array(ImageSource).max(4).default([]).describe('Reference images of the place.'),
})

export const createLocationTool = defineTool({
  name: 'create_location',
  risk: 'write',
  description:
    'Create a location with optional reference images (media asset ids, shot start frames or local files). ' +
    'Assign it to shots with edit_shots locationId.',
  input: CreateLocationInput,
  handler: async (args, { api, workspaceId }) => {
    const context = { workspaceId, projectId: args.projectId }
    const referenceAssetIds = await mapLimited(args.references, 2, (source) => resolveImage(api, source, context))
    const location = await api.post(
      `/projects/${seg(args.projectId)}/locations`,
      {
        name: args.name,
        ...(args.description === undefined ? {} : { description: args.description }),
        referenceAssetIds,
      },
      WireLocation,
    )
    return jsonResult({ locationId: location.id, name: location.name, referenceAssetIds: location.referenceAssetIds ?? [] })
  },
})
