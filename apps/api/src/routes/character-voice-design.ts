import { createHash } from 'node:crypto'
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  CharacterId as CharacterIdSchema,
  DesignedVoiceGender,
  GeminiKeyLabel,
  MAX_DESIGNED_VOICE_DESCRIPTION,
  MediaAssetId as MediaAssetIdSchema,
  VOICE_NAME_MAX,
  VoiceProfileId as VoiceProfileIdSchema,
  newId,
  type CreateVoiceProfileInput,
  type MediaAssetId,
  type Project,
  type VoiceProfile,
  type VoiceProfileId,
} from '@ixa/domain'
import { VoiceProviderError } from '@ixa/provider-core'
import { GEMINI_DEFAULT_TTS_MODEL } from '@ixa/provider-voice'
import { mediaKey } from '@ixa/storage'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, ok, successResponse } from '../response.js'
import { isUniqueViolation } from './unique-violation.js'
import type { DubRoutesDeps } from '../dub/deps.js'
import { DUPLICATE_VOICE_NAME_MESSAGE, VoiceProfileResponse, toVoiceResponse } from './narration-voices.js'

/**
 * 声を説明から作る（Voice Design。ADR-0062）。**押したときだけ Gemini を呼ぶ（課金）。** 作った声はすぐに
 * そのキャラクターの声として保存する（Gemini 側にも残るので、保存しないと作った声を失う）。試し聞きは素材にして返す。
 *
 * 作った声は**作った鍵のプロジェクトでしか読めない**ので、鍵の名札（秘密ではない）と一緒に保存する。
 */

export const VOICE_DESIGN_BUSY_MESSAGE = 'このキャラクターの声を作っている最中です。できてからもう一度押してください'

/** 同じ名前が埋まっていたときに試す「（2）」〜の数。払った声を失わないための逃げ道なので、上限は余裕を持たせる。 */
const MAX_NAME_SUFFIX = 20

export const VOICE_DESIGN_UNAVAILABLE_MESSAGE =
  'この環境では説明から声を作れません（Gemini の声を使う設定と、鍵の名札が必要です）'

export const DesignVoiceBody = z
  .object({
    description: z.string().trim().min(1).max(MAX_DESIGNED_VOICE_DESCRIPTION),
    gender: DesignedVoiceGender,
    /** 声の名前（作品の中で一意）。 */
    displayName: z.string().trim().min(1).max(VOICE_NAME_MAX),
  })
  .strict()
  .openapi('DesignVoiceInput')

const DesignVoiceResponse = z
  .object({ voice: VoiceProfileResponse, sampleMediaAssetId: MediaAssetIdSchema.nullable() })
  .openapi('DesignedVoiceResult')

const designRoute = createRoute({
  method: 'post', path: '/characters/{id}/voices/design', tags: ['narration'],
  summary: '説明から声を作り、このキャラクターの声として保存する（Gemini を呼ぶ。課金）',
  request: {
    params: z.object({ id: CharacterIdSchema.openapi({ param: { name: 'id', in: 'path' } }) }),
    body: { required: true, content: { 'application/json': { schema: DesignVoiceBody } } },
  },
  responses: {
    201: { description: '作った声と試し聞き', content: { 'application/json': { schema: successResponse(DesignVoiceResponse) } } },
    404: errorContent('キャラクターが存在しない'),
    409: errorContent('同じ名前の声がある'),
    429: errorContent('このキャラクターの声を作っている最中'),
    422: errorContent('入力の検証に失敗した'),
    502: errorContent('声を作れなかった'),
    503: errorContent('この環境では作れない'),
  },
})

type Deps = Pick<DubRoutesDeps, 'characters' | 'voices' | 'projects' | 'mediaAssets' | 'storage' | 'voiceDesign' | 'logger'>

/**
 * 試し聞きを素材にする。同じ中身の素材がこの作品にあればそれを指す。**別の作品の素材は指さない**
 * （同じ中身の素材は 2 つ作れないので、そのときは保存せず null。声そのものは保存してある）。
 */
const storeSample = async (deps: Deps, project: Project, voiceProfileId: VoiceProfileId, wav: Buffer): Promise<MediaAssetId | null> => {
  const checksumSha256 = createHash('sha256').update(wav).digest('hex')
  const existing = await deps.mediaAssets.findByChecksum(checksumSha256)
  if (existing !== null && existing.projectId === project.id) return existing.id
  if (existing !== null) {
    deps.logger.warn({ voiceProfileId }, '試し聞きと同じ中身の素材が別の作品にあるので、試し聞きは保存しません')
    return null
  }
  const id = newId(MediaAssetIdSchema)
  const storageKey = mediaKey(project.workspaceId, id, 'wav')
  await deps.storage.put(storageKey, wav, { contentType: 'audio/wav' })
  await deps.mediaAssets.create({
    id,
    workspaceId: project.workspaceId,
    projectId: project.id,
    kind: 'audio',
    storageKey,
    mimeType: 'audio/wav',
    bytes: wav.byteLength,
    checksumSha256,
    origin: { type: 'voice_design', voiceProfileId },
  })
  return id
}

const suffixedName = (base: string, n: number): string => {
  const suffix = `（${String(n)}）`
  return `${base.slice(0, Math.max(0, VOICE_NAME_MAX - suffix.length))}${suffix}`
}

/**
 * 作った声を保存する。**払った声を失わない**: 名前の確かめの後に同じ名前が入っていたら（同時に作った）、
 * 「（2）」「（3）」…を付けて保存し直す。それでも保存できなければ、声の ID をログに残して投げる（手で拾える）。
 */
const saveDesignedVoice = async (deps: Deps, input: CreateVoiceProfileInput & { readonly id: VoiceProfileId }, attempt = 1): Promise<VoiceProfile> => {
  const name = attempt === 1 ? input.name : suffixedName(input.name, attempt)
  try {
    return await deps.voices.create({ ...input, name })
  } catch (error) {
    if (!isUniqueViolation(error) || attempt >= MAX_NAME_SUFFIX) {
      deps.logger.error({ voiceName: input.voiceName, err: error }, '作った声を保存できませんでした（声の ID を手で登録してください）')
      throw error
    }
    return saveDesignedVoice(deps, input, attempt + 1)
  }
}

export const characterVoiceDesignRoutes = (deps: Deps) => {
  /** いま声を作っているキャラクター（同じキャラクターで続けて押されても二重に払わない。この API の中だけ）。 */
  let designing: ReadonlySet<string> = new Set()
  return new OpenAPIHono({ defaultHook: validationHook }).openapi(designRoute, async (c) => {
    const character = await deps.characters.findById(c.req.valid('param').id)
    if (character === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
    const project = await deps.projects.findById(character.projectId)
    if (project === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
    const design = deps.voiceDesign
    const keyLabel = design === null ? null : GeminiKeyLabel.safeParse(design.keyLabel)
    if (design === null || keyLabel === null || !keyLabel.success) return c.json(fail(VOICE_DESIGN_UNAVAILABLE_MESSAGE), 503)
    const input = c.req.valid('json')
    if ((await deps.voices.findByName(project.id, input.displayName)) !== null) return c.json(fail(DUPLICATE_VOICE_NAME_MESSAGE), 409)
    if (designing.has(character.id)) return c.json(fail(VOICE_DESIGN_BUSY_MESSAGE), 429)
    designing = new Set([...designing, character.id])

    const designed = await design
      .designVoice({ description: input.description, gender: input.gender, displayName: input.displayName, languageCode: 'ja-JP' })
      .catch((error: unknown) => {
        if (error instanceof VoiceProviderError) return { error: error.message }
        throw error
      })
      .finally(() => {
        designing = new Set([...designing].filter((id) => id !== character.id))
      })
    if ('error' in designed) return c.json(fail(`声を作れませんでした: ${designed.error}`), 502)

    const id = newId(VoiceProfileIdSchema)
    const voice = await saveDesignedVoice(deps, {
      id,
      projectId: project.id,
      name: input.displayName,
      tool: 'gemini_api',
      model: GEMINI_DEFAULT_TTS_MODEL,
      voiceName: designed.voiceId,
      characterId: character.id,
      designedVoice: { description: input.description, gender: input.gender, keyLabel: keyLabel.data },
    })
    const sampleMediaAssetId = designed.sampleWav === null ? null : await storeSample(deps, project, id, designed.sampleWav)
    deps.logger.info({ voiceProfileId: id, characterId: character.id }, '説明から声を作りました')
    return c.json(ok({ voice: toVoiceResponse(voice), sampleMediaAssetId }), 201)
  })
}
