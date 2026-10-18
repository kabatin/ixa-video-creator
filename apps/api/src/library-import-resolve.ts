import type {
  BrandAssetRepository,
  CharacterRepository,
  LocationRepository,
  MusicTrackRepository,
  ProjectRepository,
  SfxJobRepository,
  VoiceProfileRepository,
} from '@ixa/db'
import {
  importSfxSoundInput,
  importVoiceInput,
  type BrandAsset,
  type BrandAssetId,
  type Character,
  type CharacterId,
  type ImportedSfxSound,
  type Location,
  type LocationId,
  type MediaAssetId,
  type MusicTrack,
  type MusicTrackId,
  type Project,
  type ProjectId,
  type SfxJobId,
  type VoiceProfile,
  type VoiceProfileId,
  type WorkspaceId,
} from '@ixa/domain'
import { sequentially } from './sequentially.js'

/**
 * 取り込み（ADR-0034・ADR-0053）の**書く前の確かめ**と、声・効果音の書き方。
 * 取り込めるのは同じワークスペースのものだけ。1 件でも無い・別のワークスペースなら、その段を断る（何も作らない）。
 */

export type ImportSelection = {
  readonly characterIds: readonly CharacterId[]
  readonly locationIds: readonly LocationId[]
  readonly brandAssetIds: readonly BrandAssetId[]
  readonly voiceIds: readonly VoiceProfileId[]
  readonly musicTrackIds: readonly MusicTrackId[]
  readonly sfxSounds: readonly { readonly sfxJobId: SfxJobId; readonly mediaAssetId: MediaAssetId }[]
}

export type ResolveDeps = {
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly characters: Pick<CharacterRepository, 'findById'>
  readonly locations: Pick<LocationRepository, 'findById'>
  readonly brandAssets: Pick<BrandAssetRepository, 'findById'>
  readonly musicTracks: Pick<MusicTrackRepository, 'findById'>
  readonly voices?: Pick<VoiceProfileRepository, 'findById'>
  readonly sfxJobs?: Pick<SfxJobRepository, 'findById'>
}

export type ResolvedImport = {
  readonly characters: readonly Character[]
  readonly locations: readonly Location[]
  readonly brandAssets: readonly BrandAsset[]
  readonly voices: readonly VoiceProfile[]
  readonly musicTracks: readonly MusicTrack[]
  readonly sfxSounds: readonly ImportedSfxSound[]
}

type Field = keyof ImportSelection

/** 取り込めるものだけを引く。1 件でも無い・ワークスペースが違えば null。 */
const resolveAll = async <Id, T>(
  ids: readonly Id[],
  find: (id: Id) => Promise<T | null>,
  usable: (item: T) => Promise<boolean>,
): Promise<readonly T[] | null> => {
  const found = await Promise.all(
    ids.map(async (id): Promise<readonly T[]> => {
      const item = await find(id)
      return item !== null && (await usable(item)) ? [item] : []
    }),
  )
  const kept = found.flat()
  return kept.length === ids.length ? kept : null
}

/** 作品ごとのもの（声・楽曲・効果音）はワークスペースを持たないので、持ち主の作品で確かめる。作品は 1 回だけ引く。 */
const projectWorkspaces = (deps: ResolveDeps) => {
  const cache = new Map<ProjectId, Promise<Project | null>>()
  return async (projectId: ProjectId, workspaceId: WorkspaceId): Promise<boolean> => {
    const pending = cache.get(projectId) ?? deps.projects.findById(projectId)
    cache.set(projectId, pending)
    return (await pending)?.workspaceId === workspaceId
  }
}

export const resolveImport = async (
  deps: ResolveDeps,
  selection: ImportSelection,
  workspaceId: WorkspaceId,
  targetId: ProjectId,
): Promise<{ readonly ok: true; readonly value: ResolvedImport } | { readonly ok: false; readonly failed: readonly Field[] }> => {
  const sameWorkspace = projectWorkspaces(deps)
  const inWorkspace = (item: { readonly workspaceId: string }): Promise<boolean> =>
    Promise.resolve(item.workspaceId === workspaceId)
  const ofProject = (item: { readonly projectId: ProjectId }): Promise<boolean> =>
    sameWorkspace(item.projectId, workspaceId)
  const { voices, sfxJobs } = deps

  const [characters, locations, brandAssets, voiceRows, musicTracks, sfxSounds] = await Promise.all([
    resolveAll(selection.characterIds, (id) => deps.characters.findById(id), inWorkspace),
    resolveAll(selection.locationIds, (id) => deps.locations.findById(id), inWorkspace),
    resolveAll(selection.brandAssetIds, (id) => deps.brandAssets.findById(id), inWorkspace),
    // 口を繋いでいない環境では、頼まれた分だけ断る（頼まれていなければ空で通す）。
    voices === undefined
      ? selection.voiceIds.length === 0 ? [] : null
      : resolveAll(selection.voiceIds, (id) => voices.findById(id), ofProject),
    resolveAll(selection.musicTrackIds, (id) => deps.musicTracks.findById(id), ofProject),
    sfxJobs === undefined
      ? selection.sfxSounds.length === 0 ? [] : null
      : resolveAll(
          selection.sfxSounds,
          async (ref) => {
            const job = await sfxJobs.findById(ref.sfxJobId)
            return job === null ? null : { job, sound: importSfxSoundInput(job, ref.mediaAssetId, targetId) }
          },
          async ({ job, sound }) => sound !== null && (await ofProject(job)),
        ).then((found) => found?.flatMap(({ sound }) => (sound === null ? [] : [sound])) ?? null),
  ])

  const results: readonly (readonly [Field, readonly unknown[] | null])[] = [
    ['characterIds', characters],
    ['locationIds', locations],
    ['brandAssetIds', brandAssets],
    ['voiceIds', voiceRows],
    ['musicTrackIds', musicTracks],
    ['sfxSounds', sfxSounds],
  ]
  const failed = results.flatMap(([field, value]) => (value === null ? [field] : []))
  if (
    characters === null || locations === null || brandAssets === null ||
    voiceRows === null || musicTracks === null || sfxSounds === null
  ) {
    return { ok: false, failed }
  }
  return { ok: true, value: { characters, locations, brandAssets, voices: voiceRows, musicTracks, sfxSounds } }
}

/**
 * 声を写す（ADR-0053）。名前が取り込み先とぶつかればずらす（作品の中で声の名前は一意）。
 * 1 件ずつ順に作る（前に写した声の名前とも比べる）。
 */
export const copyVoices = async (
  deps: { readonly voices?: Pick<VoiceProfileRepository, 'findByProject' | 'create'> },
  sources: readonly VoiceProfile[],
  target: Pick<Project, 'id'>,
  characters: ReadonlyMap<CharacterId, CharacterId>,
): Promise<readonly VoiceProfile[]> => {
  const { voices } = deps
  if (voices === undefined || sources.length === 0) return []
  const existing = (await voices.findByProject(target.id)).map((voice) => voice.name)
  const copied = await sources.reduce<Promise<readonly VoiceProfile[]>>(async (done, voice) => {
    const before = await done
    const takenNames = [...existing, ...before.map((other) => other.name)]
    const created = await voices.create(importVoiceInput(voice, { projectId: target.id, characters, takenNames }))
    return [...before, created]
  }, Promise.resolve([]))
  return copied
}

/** 効果音を、取り込み先の「置いていない候補」として記す（ADR-0053）。 */
export const recordSfxSounds = async (
  deps: { readonly sfxJobs?: Pick<SfxJobRepository, 'recordImported'> },
  sounds: readonly ImportedSfxSound[],
): Promise<readonly { readonly sfxJobId: SfxJobId; readonly mediaAssetId: MediaAssetId }[]> => {
  const { sfxJobs } = deps
  if (sfxJobs === undefined) return []
  return sequentially(sounds, async (sound) => {
    const recorded = await sfxJobs.recordImported(sound)
    return recorded.mediaAssetIds.map((mediaAssetId) => ({ sfxJobId: recorded.id, mediaAssetId }))
  }).then((rows) => rows.flat())
}
