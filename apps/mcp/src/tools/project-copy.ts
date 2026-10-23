import { DUPLICATION_ITEMS, DuplicationItem, PROJECT_NAME_MAX_LENGTH } from '@ixa/domain'
import { z } from 'zod'
import { seg, type ApiClient } from '../api-client.js'
import { assertListed } from '../lib/project-scope.js'
import { WireCharacter, WireLocation, WireMusicTrack, WireProject } from '../wire.js'
import { defineTool, Id, jsonResult, ToolInputError } from '../tool-def.js'

/**
 * 作品の複製と、ほかの作品からの取り込み（ADR-0037・ADR-0034・ADR-0053）。
 * どちらも会話の作品の外を触るので、AI エージェントのタブは必ず確認する（agent-service.ts の touchesOutside）。
 */

/** 取り込みの 1 回の上限（API の library-imports.ts の MAX_IMPORT_ITEMS と同じ）。 */
const MAX_IMPORT_ITEMS = 50

const WireDuplicated = z.object({ project: WireProject, notes: z.array(z.string()) })

export const DuplicateProjectInput = z.object({
  projectId: Id.describe('The project to copy.'),
  name: z.string().trim().min(1).max(PROJECT_NAME_MAX_LENGTH).describe('Name of the new project (Japanese).'),
  items: z
    .array(DuplicationItem)
    .max(DUPLICATION_ITEMS.length)
    .refine((items) => new Set(items).size === items.length, 'duplicate items')
    .default([...DUPLICATION_ITEMS])
    .describe(
      'What to carry over (default: everything). lyricTiming needs music+concept; narration needs voices; ' +
        'storyboard/frames/takes need shots. Name, format and budget are always kept.',
    ),
})

export const duplicateProjectTool = defineTool({
  name: 'duplicate_project',
  // 新しい作品を作る（create_project と同じく確認する）。
  risk: 'destructive',
  description:
    'Copy a project into a new one, choosing which parts to carry over. Returns the new project id and notes on ' +
    'anything left out.',
  input: DuplicateProjectInput,
  handler: async ({ projectId, name, items }, { api }) => {
    const created = await api.post(`/projects/${seg(projectId)}/duplicate`, { name, items }, WireDuplicated)
    return jsonResult({
      project: { id: created.project.id, name: created.project.name, status: created.project.status },
      notes: created.notes,
    })
  },
})

const WireBrandAsset = z.object({ id: z.string(), category: z.string(), name: z.string() })
const WireVoice = z.object({ id: z.string(), name: z.string(), tool: z.string() })
const WireSfxJob = z.object({ id: z.string(), prompt: z.string(), mediaAssetIds: z.array(z.string()) })

const Ids = z
  .array(Id)
  .max(MAX_IMPORT_ITEMS)
  .refine((ids) => new Set(ids).size === ids.length, 'duplicate ids')
  .default([])

export const ImportFromProjectInput = z.object({
  projectId: Id.describe('The project to import into (usually the current one).'),
  sourceProjectId: Id.describe('The other project to read from (ids from ixa_status projects).'),
  action: z
    .enum(['list', 'import'])
    .describe('list = show what the source project has; import = copy the given items into projectId.'),
  characterIds: Ids,
  locationIds: Ids,
  brandAssetIds: Ids,
  voiceIds: Ids,
  musicTrackIds: Ids,
  sfxSounds: z
    .array(z.object({ sfxJobId: Id, mediaAssetId: Id }).strict())
    .max(MAX_IMPORT_ITEMS)
    .refine(
      (sounds) => new Set(sounds.map((s) => `${s.sfxJobId}/${s.mediaAssetId}`)).size === sounds.length,
      'duplicate sounds',
    )
    .default([])
    .describe('One sound effect = a job and one of its media assets (from list).'),
})

const WireImported = z.object({
  characters: z.array(WireCharacter),
  locations: z.array(WireLocation),
  brandAssets: z.array(WireBrandAsset),
  voices: z.array(WireVoice),
  musicTracks: z.array(WireMusicTrack),
  sfxSounds: z.array(z.object({ sfxJobId: z.string(), mediaAssetId: z.string() })),
})

const listSource = async (api: ApiClient, sourceProjectId: string) => {
  const base = `/projects/${seg(sourceProjectId)}`
  const [characters, locations, brandAssets, voices, musicTracks, sfxJobs] = await Promise.all([
    api.get(`${base}/characters`, z.array(WireCharacter)),
    api.get(`${base}/locations`, z.array(WireLocation)),
    api.get(`${base}/brand-assets`, z.array(WireBrandAsset)),
    api.get(`${base}/voices`, z.array(WireVoice)),
    api.get(`${base}/music-tracks`, z.array(WireMusicTrack)),
    api.get(`${base}/sfx-jobs`, z.array(WireSfxJob)),
  ])
  return {
    characters: characters.map((c) => ({ id: c.id, displayName: c.displayName })),
    locations: locations.map((l) => ({ id: l.id, name: l.name })),
    brandAssets: brandAssets.map((b) => ({ id: b.id, category: b.category, name: b.name })),
    voices: voices.map((v) => ({ id: v.id, name: v.name, tool: v.tool })),
    musicTracks: musicTracks.map((t) => ({ id: t.id, title: t.title })),
    sfxSounds: sfxJobs.flatMap((job) =>
      job.mediaAssetIds.map((mediaAssetId) => ({ sfxJobId: job.id, mediaAssetId, prompt: job.prompt })),
    ),
  }
}

type Selection = Omit<z.infer<typeof ImportFromProjectInput>, 'projectId' | 'sourceProjectId' | 'action'>

/** 一覧の口の名前と、断るときの名前。 */
const SOURCE_LISTS = [
  ['characterIds', 'characters', 'キャラクター'],
  ['locationIds', 'locations', '場所'],
  ['brandAssetIds', 'brand-assets', 'ブランド資産'],
  ['voiceIds', 'voices', '声'],
  ['musicTrackIds', 'music-tracks', '曲'],
] as const

/**
 * 選んだものが全部、取り込み元（sourceProjectId）の作品のものか。
 * API はワークスペースが同じかしか見ないので、確かめないと取り込み元を名乗りながら第三の作品から写せてしまう。
 */
const assertInSource = async (api: ApiClient, sourceProjectId: string, selection: Selection): Promise<void> => {
  const base = `/projects/${seg(sourceProjectId)}`
  await Promise.all(
    SOURCE_LISTS.filter(([field]) => selection[field].length > 0).map(([field, path, label]) =>
      assertListed(api, `${base}/${path}`, selection[field], `${label}（取り込み元）`),
    ),
  )
  if (selection.sfxSounds.length === 0) return
  const jobs = await api.get(`${base}/sfx-jobs`, z.array(WireSfxJob))
  const known = new Set(jobs.flatMap((job) => job.mediaAssetIds.map((mediaAssetId) => `${job.id}/${mediaAssetId}`)))
  const foreign = selection.sfxSounds.filter((s) => !known.has(`${s.sfxJobId}/${s.mediaAssetId}`))
  if (foreign.length > 0) {
    throw new ToolInputError(`この作品に無い効果音（取り込み元）です: ${foreign.map((s) => s.mediaAssetId).join(', ')}`)
  }
}

export const importFromProjectTool = defineTool({
  name: 'import_from_project',
  // ほかの作品を読む（会話の作品の外を触る。create_project と同じく確認する）。
  risk: 'destructive',
  description:
    'Copy characters (with looks and images), locations, brand assets, voices, music tracks or sound effects from ' +
    'another project into this one. action="list" shows what the source has; "import" copies the given ids. ' +
    'Copies are independent afterwards.',
  input: ImportFromProjectInput,
  handler: async ({ projectId, sourceProjectId, action, ...selection }, { api }) => {
    if (projectId === sourceProjectId) throw new ToolInputError('取り込み元と取り込み先が同じ作品です')
    if (action === 'list') return jsonResult({ sourceProjectId, ...(await listSource(api, sourceProjectId)) })
    const count = Object.values(selection).reduce((sum, ids) => sum + ids.length, 0)
    if (count === 0) throw new ToolInputError('取り込むものを 1 つ以上指定してください（action:"list" で一覧）')
    await assertInSource(api, sourceProjectId, selection)
    const imported = await api.post(`/projects/${seg(projectId)}/library-imports`, selection, WireImported)
    return jsonResult({
      characters: imported.characters.map((c) => ({ id: c.id, displayName: c.displayName })),
      locations: imported.locations.map((l) => ({ id: l.id, name: l.name })),
      brandAssets: imported.brandAssets.map((b) => ({ id: b.id, name: b.name })),
      voices: imported.voices.map((v) => ({ id: v.id, name: v.name })),
      musicTracks: imported.musicTracks.map((t) => ({ id: t.id, title: t.title })),
      sfxSounds: imported.sfxSounds,
    })
  },
})
