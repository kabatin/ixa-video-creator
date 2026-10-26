import { IdentityImageRole, LookImageRole, MAX_DUB_LEVEL_DB, MIN_DUB_LEVEL_DB, type ToolRisk } from '@ixa/domain'
import { z } from 'zod'
import { seg, type ApiClient } from '../api-client.js'
import { SpeechFields } from '../lib/dialogue-input.js'
import { assertListed } from '../lib/project-scope.js'
import { ImageSource, resolveImage } from '../lib/image-source.js'
import { defineTool, Id, jsonResult, mapLimited, ToolInputError } from '../tool-def.js'

/**
 * 登場人物を直す・消す。Look（衣装などの時期ごとの外見）・顔の画像・キャラクターシートもここ。
 * どの操作も、相手が `projectId` の作品のものかを先に確かめる（別の作品のものを ID だけで触らせない）。
 */

const WireOwnedCharacter = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  identityAnchors: z.array(z.string()).optional(),
  styleTokens: z.array(z.string()).optional(),
  speakerNo: z.number().optional(),
  speechName: z.string().nullable().optional(),
  voiceDescription: z.string().nullable().optional(),
  dialogueVoiceProfileId: z.string().nullable().optional(),
  dialogueLevelDb: z.number().optional(),
})
const WireFullLook = z.object({
  id: z.string(),
  characterId: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string().optional(),
  wardrobeTokens: z.array(z.string()).optional(),
  isDefault: z.boolean().optional(),
  canonicalFrameAssetId: z.string().nullable().optional(),
})
const WireImage = z.object({ id: z.string(), mediaAssetId: z.string(), role: z.string(), isPrimary: z.boolean().optional() })
const WireSheetState = z.object({
  job: z.object({ id: z.string(), status: z.string(), error: z.string().nullable() }).nullable(),
})

const Tokens = z.array(z.string().min(1).max(200)).max(20)

const CharacterFields = z.object({
  name: z.string().min(1).max(100).optional(),
  displayName: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).optional(),
  identityAnchors: Tokens.optional(),
  styleTokens: Tokens.optional(),
  colorPalette: Tokens.optional(),
  // セリフの声（ADR-0059）
  ...SpeechFields,
  // 声の差し替え（ADR-0062）
  dialogueVoiceProfileId: Id.nullable()
    .optional()
    .describe('Voice used by dub_takes for this character (a voice of this project: set_narration voices or design_voice). null clears.'),
  dialogueLevelDb: z
    .number()
    .finite()
    .min(MIN_DUB_LEVEL_DB)
    .max(MAX_DUB_LEVEL_DB)
    .optional()
    .describe('Default distance in dB for dubbed lines (0 = as loud as the H3 voice; e.g. -9.5 far, -2 close).'),
})

const LookFields = z.object({
  key: z
    .string()
    .regex(/^[A-Z0-9_]{1,40}$/)
    .optional()
    .describe('add_look only: uppercase id used by shots, e.g. "WINTER". Cannot be changed later.'),
  name: z.string().min(1).max(200).optional().describe('Look name shown to the user (Japanese).'),
  era: z.string().max(200).nullable().optional(),
  description: z.string().max(4000).optional(),
  wardrobeTokens: Tokens.optional(),
  styleTokens: Tokens.optional(),
  colorPalette: Tokens.optional(),
  isDefault: z.boolean().optional().describe('Make this the default look (the old default is unset).'),
})

export const EDIT_CHARACTER_ACTIONS = [
  'get',
  'update',
  'delete',
  'add_look',
  'update_look',
  'delete_look',
  'add_look_image',
  'remove_look_image',
  'set_canonical_frame',
  'add_identity_image',
  'remove_identity_image',
  'set_primary_identity_image',
  'make_character_sheet',
] as const

export const EditCharacterInput = z.object({
  projectId: Id,
  characterId: Id,
  action: z.enum(EDIT_CHARACTER_ACTIONS),
  character: CharacterFields.optional().describe(
    'update: fields to change, nested here — e.g. {"speechName":"The cat","voiceDescription":"a soft, sly voice"}. ' +
      'Fields placed next to action are ignored.',
  ),
  lookId: Id.optional().describe('Look actions (except add_look).'),
  look: LookFields.optional().describe('add_look / update_look fields.'),
  image: ImageSource.optional().describe('add_look_image / set_canonical_frame / add_identity_image.'),
  role: z
    .union([IdentityImageRole, LookImageRole])
    .optional()
    .describe(
      'Image role. Identity: four_view, face_front (default), face_side, face_three_quarter, full_body, profile. ' +
        'Look: wardrobe, hair, full_body, reference_still (default).',
    ),
  imageId: Id.optional().describe('remove_* / set_primary_identity_image: the image row id from get.'),
  referenceIdentityImageId: Id.optional().describe('make_character_sheet: which identity image to draw from.'),
})
type Args = z.infer<typeof EditCharacterInput>

/** update で character を包み忘れたとき（上に置いた項目は入力の形に無いので落ちる）に、正しい形を例で示す。 */
export const CHARACTER_UPDATE_SHAPE_MESSAGE =
  'character に変える項目を入れてください。項目は character の中に書きます' +
  '（例: {"action":"update","character":{"speechName":"The cat","voiceDescription":"a soft, sly voice"}}）'

const need = <T>(value: T | undefined, message: string): T => {
  if (value === undefined) throw new ToolInputError(message)
  return value
}

const ownedCharacter = async (api: ApiClient, args: Args) => {
  const character = await api.get(`/characters/${seg(args.characterId)}`, WireOwnedCharacter)
  if (character.projectId !== args.projectId) throw new ToolInputError('そのキャラクターはこの作品のものではありません')
  return character
}

const ownedLook = async (api: ApiClient, args: Args) => {
  const look = await api.get(`/looks/${seg(need(args.lookId, 'lookId を指定してください'))}`, WireFullLook)
  if (look.characterId !== args.characterId) throw new ToolInputError('その Look はこのキャラクターのものではありません')
  return look
}

/** 行の ID が、そのキャラクター（または Look）の画像の一覧にあるか。 */
const ownedImageId = async (api: ApiClient, listPath: string, args: Args): Promise<string> => {
  const imageId = need(args.imageId, 'imageId を指定してください（action:"get" の一覧から）')
  const images = await api.get(listPath, z.array(WireImage))
  if (!images.some((image) => image.id === imageId)) throw new ToolInputError('その画像はこのキャラクターのものではありません')
  return imageId
}

const imageOf = async (api: ApiClient, args: Args, workspaceId: string): Promise<string> =>
  resolveImage(api, need(args.image, 'image を指定してください'), { workspaceId, projectId: args.projectId })

const roleIn = <T extends string>(allowed: readonly T[], role: string | undefined, fallback: T): T => {
  if (role === undefined) return fallback
  if (!(allowed as readonly string[]).includes(role)) {
    throw new ToolInputError(`role は ${allowed.join('・')} のどれかにしてください`)
  }
  return role as T
}

const describeCharacter = async (api: ApiClient, characterId: string) => {
  const base = `/characters/${seg(characterId)}`
  const [character, looks, identityImages, sheet] = await Promise.all([
    api.get(base, WireOwnedCharacter),
    api.get(`${base}/looks`, z.array(WireFullLook)),
    api.get(`${base}/identity-images`, z.array(WireImage)),
    api.get(`${base}/character-sheet`, WireSheetState),
  ])
  const lookImages = await mapLimited(looks, 4, (look) => api.get(`/looks/${seg(look.id)}/images`, z.array(WireImage)))
  return {
    character: {
      id: character.id,
      name: character.name,
      displayName: character.displayName,
      description: character.description ?? '',
      identityAnchors: character.identityAnchors ?? [],
      styleTokens: character.styleTokens ?? [],
      speakerTag: character.speakerNo === undefined ? null : `S${String(character.speakerNo)}`,
      speechName: character.speechName ?? null,
      voiceDescription: character.voiceDescription ?? null,
      dialogueVoiceProfileId: character.dialogueVoiceProfileId ?? null,
      dialogueLevelDb: character.dialogueLevelDb ?? 0,
    },
    identityImages: identityImages.map((i) => ({ id: i.id, mediaAssetId: i.mediaAssetId, role: i.role, isPrimary: i.isPrimary ?? false })),
    looks: looks.map((look, index) => ({
      id: look.id,
      key: look.key,
      name: look.name,
      isDefault: look.isDefault ?? false,
      description: look.description ?? '',
      wardrobeTokens: look.wardrobeTokens ?? [],
      canonicalFrameAssetId: look.canonicalFrameAssetId ?? null,
      images: (lookImages[index] ?? []).map((i) => ({ id: i.id, mediaAssetId: i.mediaAssetId, role: i.role })),
    })),
    characterSheet: sheet.job,
  }
}

const Deleted = z.unknown()

type Handler = (args: Args, api: ApiClient, workspaceId: string) => Promise<unknown>

const HANDLERS: Readonly<Record<Args['action'], Handler>> = {
  get: async (args, api) => describeCharacter(api, args.characterId),
  update: async (args, api) => {
    const patch = need(args.character, CHARACTER_UPDATE_SHAPE_MESSAGE)
    if (Object.keys(patch).length === 0) throw new ToolInputError(CHARACTER_UPDATE_SHAPE_MESSAGE)
    // セリフの声は、この作品の声だけ（別の作品の声を ID だけで指させない）。
    const voiceId = patch.dialogueVoiceProfileId
    if (voiceId !== undefined && voiceId !== null) {
      await assertListed(api, `/projects/${seg(args.projectId)}/voices`, [voiceId], '声')
    }
    await api.request('PATCH', `/characters/${seg(args.characterId)}`, WireOwnedCharacter, { body: patch })
    return describeCharacter(api, args.characterId)
  },
  delete: async (args, api) => {
    await api.request('DELETE', `/characters/${seg(args.characterId)}`, Deleted)
    return { deleted: args.characterId }
  },
  add_look: async (args, api) => {
    const look = need(args.look, 'look に key と name を入れてください')
    if (look.key === undefined || look.name === undefined) throw new ToolInputError('add_look には look.key と look.name が要ります')
    const created = await api.post(`/characters/${seg(args.characterId)}/looks`, look, WireFullLook)
    return { lookId: created.id, key: created.key, name: created.name, isDefault: created.isDefault ?? false }
  },
  update_look: async (args, api) => {
    const current = await ownedLook(api, args)
    const { key, ...patch } = need(args.look, 'look に変える項目を入れてください')
    if (key !== undefined) throw new ToolInputError('Look の key は変えられません（Shot から指す名前のため）')
    if (Object.keys(patch).length === 0) throw new ToolInputError('look に変える項目を入れてください')
    const updated = await api.request('PATCH', `/looks/${seg(current.id)}`, WireFullLook, { body: patch })
    return { lookId: updated.id, name: updated.name, isDefault: updated.isDefault ?? false }
  },
  delete_look: async (args, api) => {
    const look = await ownedLook(api, args)
    await api.request('DELETE', `/looks/${seg(look.id)}`, Deleted)
    return { deleted: look.id }
  },
  add_look_image: async (args, api, workspaceId) => {
    const look = await ownedLook(api, args)
    const existing = await api.get(`/looks/${seg(look.id)}/images`, z.array(WireImage))
    const created = await api.post(
      `/looks/${seg(look.id)}/images`,
      {
        mediaAssetId: await imageOf(api, args, workspaceId),
        role: roleIn(LookImageRole.options, args.role, 'reference_still'),
        isPrimary: existing.length === 0,
        order: existing.length,
      },
      WireImage,
    )
    return { imageId: created.id, mediaAssetId: created.mediaAssetId, role: created.role }
  },
  remove_look_image: async (args, api) => {
    const look = await ownedLook(api, args)
    const imageId = await ownedImageId(api, `/looks/${seg(look.id)}/images`, args)
    await api.request('DELETE', `/look-images/${seg(imageId)}`, Deleted)
    return { deleted: imageId }
  },
  set_canonical_frame: async (args, api, workspaceId) => {
    const look = await ownedLook(api, args)
    const updated = await api.post(
      `/looks/${seg(look.id)}/canonical-frame`,
      { mediaAssetId: await imageOf(api, args, workspaceId) },
      WireFullLook,
    )
    return { lookId: updated.id, canonicalFrameAssetId: updated.canonicalFrameAssetId ?? null }
  },
  add_identity_image: async (args, api, workspaceId) => {
    const path = `/characters/${seg(args.characterId)}/identity-images`
    const role = roleIn(IdentityImageRole.options, args.role, 'face_front')
    const existing = await api.get(path, z.array(WireImage))
    const created = await api.post(
      path,
      {
        mediaAssetId: await imageOf(api, args, workspaceId),
        role,
        isPrimary: !existing.some((image) => image.role === role),
        order: existing.length,
      },
      WireImage,
    )
    return { imageId: created.id, mediaAssetId: created.mediaAssetId, role: created.role, isPrimary: created.isPrimary ?? false }
  },
  remove_identity_image: async (args, api) => {
    const imageId = await ownedImageId(api, `/characters/${seg(args.characterId)}/identity-images`, args)
    await api.request('DELETE', `/identity-images/${seg(imageId)}`, Deleted)
    return { deleted: imageId }
  },
  set_primary_identity_image: async (args, api) => {
    const imageId = await ownedImageId(api, `/characters/${seg(args.characterId)}/identity-images`, args)
    const updated = await api.post(`/identity-images/${seg(imageId)}/primary`, {}, WireImage)
    return { imageId: updated.id, role: updated.role, isPrimary: updated.isPrimary ?? true }
  },
  make_character_sheet: async (args, api) => {
    const started = await api.post(
      `/characters/${seg(args.characterId)}/character-sheet`,
      args.referenceIdentityImageId === undefined ? {} : { referenceIdentityImageId: args.referenceIdentityImageId },
      z.object({ jobId: z.string() }),
    )
    return { jobId: started.jobId, note: 'シートは画像の AI が描く。できたかは action:"get" の characterSheet で見る' }
  },
}

/** action ごとの危険度。ふつうの直しは確認なし、消すのは確認、シートは画像の AI を使う。 */
const ACTION_RISKS: Readonly<Record<Args['action'], ToolRisk>> = {
  get: 'read',
  update: 'write',
  delete: 'destructive',
  add_look: 'write',
  update_look: 'write',
  delete_look: 'destructive',
  add_look_image: 'write',
  remove_look_image: 'destructive',
  set_canonical_frame: 'write',
  add_identity_image: 'write',
  remove_identity_image: 'destructive',
  set_primary_identity_image: 'write',
  make_character_sheet: 'costly',
}

export const editCharacterTool = defineTool({
  name: 'edit_character',
  // 消す操作と、画像の AI で描くキャラクターシートを含む。いちばん重い印。呼び出しごとには action で決める。
  risk: 'destructive',
  riskOf: (args) => ACTION_RISKS[args.action],
  description:
    'Edit or delete a character, its looks (outfits; one is the default), look images, the canonical frame, ' +
    'identity images (face/body references) and make a character sheet (4-view image drawn by the image AI). ' +
    'Start with action="get" to see the ids. action="update" takes the fields inside character, e.g. the dialogue voice ' +
    'character: {speechName, voiceDescription} (English; every dialogue speaker needs both before generate_takes), and for ' +
    'dub_takes character: {dialogueVoiceProfileId, dialogueLevelDb}. ' +
    'Only update/delete of the character itself is undoable; look and image ' +
    'changes are not undoable.',
  input: EditCharacterInput,
  handler: async (args, { api, workspaceId }) => {
    await ownedCharacter(api, args)
    return jsonResult(await HANDLERS[args.action](args, api, workspaceId))
  },
})
