import { AspectRatio, Fps, MAX_STYLE_REFERENCES, MasteringMode, ProjectStatus, Seconds } from '@ixa/domain'
import { z } from 'zod'
import { IxaApiError, seg, type ApiClient } from '../api-client.js'
import {
  WireAppendedScript,
  WireCharacter,
  WireLocation,
  WireMusicTrack,
  WireProject,
  WireScript,
  WireShot,
  WireShotCharacter,
  WireShotPoster,
  WireTransition,
} from '../wire.js'
import { ImageSource, resolveImage } from '../lib/image-source.js'
import { defineTool, Id, jsonResult, mapLimited, round, ToolInputError } from '../tool-def.js'

/** 作品を作る・全体を見る。 */

/** 形ごとの既定の大きさ（web の resolution-presets.ts の先頭と同じ）。 */
export const DEFAULT_RESOLUTION: Readonly<Record<AspectRatio, { width: number; height: number }>> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
  '21:9': { width: 2560, height: 1080 },
}

export const CreateProjectInput = z.object({
  name: z.string().min(1).max(200).describe('Project name shown to the user (Japanese preferred).'),
  aspectRatio: AspectRatio.default('16:9'),
  fps: Fps.default(24),
  resolution: z
    .object({ width: z.number().int().positive(), height: z.number().int().positive() })
    .optional()
    .describe('Defaults by aspect: 16:9 → 1920x1080, 9:16 → 1080x1920, 1:1 → 1080x1080.'),
  concept: z
    .string()
    .max(20000)
    .optional()
    .describe('Concept / synopsis of the piece (Japanese). Stored as the project script; storyboard AI reads it.'),
  styleGuide: z.string().max(4000).optional().describe('Visual style applied to every shot prompt.'),
  avoid: z.string().max(4000).optional().describe('Things to avoid in every shot (negative guidance).'),
  budgetUsd: z.number().min(0).optional(),
})

export const createProjectTool = defineTool({
  name: 'create_project',
  // 会話の作品の外を触る。別の作品を触るのと同じく確認する（ADR-0058。レビュー 2026-10-23）。
  risk: 'destructive',
  description:
    'Create a new ixa project (a video). Defaults: 16:9, 1920x1080, 24 fps. Optional concept/synopsis, styleGuide ' +
    'and avoid text steer every generated image/video. Write user-visible text in Japanese.',
  input: CreateProjectInput,
  handler: async (args, { api, workspaceId }) => {
    const created = await api.post(
      '/projects',
      {
        workspaceId,
        name: args.name,
        fps: args.fps,
        resolution: args.resolution ?? DEFAULT_RESOLUTION[args.aspectRatio],
        aspectRatio: args.aspectRatio,
        ...(args.budgetUsd === undefined ? {} : { budgetUsd: args.budgetUsd }),
        ...(args.styleGuide === undefined ? {} : { styleGuide: args.styleGuide }),
      },
      WireProject,
    )
    // avoid は作るときには受けない口なので、作った後に直す。
    const project =
      args.avoid === undefined
        ? created
        : await api.request('PATCH', `/projects/${seg(created.id)}`, WireProject, { body: { avoid: args.avoid } })
    if (args.concept !== undefined && args.concept !== '') {
      await api.post(
        `/projects/${seg(project.id)}/script/versions`,
        { content: args.concept, authoredBy: 'ai' },
        WireAppendedScript,
      )
    }
    return jsonResult({ project: compactProject(project) })
  },
})

export const UpdateProjectInput = z.object({
  projectId: Id,
  name: z.string().min(1).max(200).optional(),
  concept: z
    .string()
    .min(1)
    .max(20000)
    .optional()
    .describe('New concept / synopsis (Japanese). Appended as a new script version; the storyboard AI reads it.'),
  styleGuide: z.string().max(4000).optional().describe('Visual style for every shot prompt. "" clears it.'),
  avoid: z.string().max(4000).optional().describe('Things to avoid in every shot. "" clears it.'),
  styleReferences: z
    .array(ImageSource)
    .max(MAX_STYLE_REFERENCES)
    .optional()
    .describe('Replaces the mood-board images sent as style references with every shot. [] clears them.'),
  durationSec: Seconds.positive().nullable().optional().describe('Target length of the piece in seconds; null clears.'),
  aspectRatio: AspectRatio.optional().describe('Screen shape (e.g. 9:16 for shorts). The resolution follows it. Change it before drawing frames.'),
  budgetUsd: z.number().min(0).nullable().optional(),
  instrumental: z.boolean().optional().describe('true = no lyrics (skips the lyric steps).'),
  status: ProjectStatus.optional(),
  masteringMode: MasteringMode.nullable()
    .optional()
    .describe(
      'Final loudness of exports. loudnorm: even out the whole piece to -14 LUFS (music videos). ' +
        'peak: only tame peaks at -1.5 dBFS, keeping the balance of take voices and music. null: automatic ' +
        '(peak when any shot has dialogue).',
    ),
})

export const updateProjectTool = defineTool({
  name: 'update_project',
  // 予算（budgetUsd）は使えるお金の上限を変えるので設定として確認する。それ以外の直しはふつうの書き込み。
  risk: 'settings',
  riskOf: (args) => (args.budgetUsd === undefined ? 'write' : 'settings'),
  description:
    'Change project settings: name, concept (new script version; not undoable), styleGuide, avoid, aspect ratio, style reference ' +
    'images (replaces all, max 3), target duration, budget, instrumental, status, masteringMode. Only the given fields change.',
  input: UpdateProjectInput,
  handler: async ({ projectId, concept, styleReferences, aspectRatio, ...fields }, { api, workspaceId }) => {
    const styleReferenceAssetIds =
      styleReferences === undefined
        ? undefined
        : await mapLimited(styleReferences, 2, (source) => resolveImage(api, source, { workspaceId, projectId }))
    const patch = Object.fromEntries(
      Object.entries({
        ...fields,
        styleReferenceAssetIds,
        // 向きを変えたら大きさも揃える（web の作品の設定と同じく、その向きの先頭の大きさ）。
        ...(aspectRatio === undefined ? {} : { aspectRatio, resolution: DEFAULT_RESOLUTION[aspectRatio] }),
      }).filter(([, value]) => value !== undefined),
    )
    if (Object.keys(patch).length === 0 && concept === undefined) {
      throw new ToolInputError('変える項目を 1 つ以上指定してください')
    }
    const base = `/projects/${seg(projectId)}`
    const project =
      Object.keys(patch).length === 0
        ? await api.get(base, WireProject)
        : await api.request('PATCH', base, WireProject, { body: patch })
    if (concept !== undefined) {
      await api.post(`${base}/script/versions`, { content: concept, authoredBy: 'ai' }, WireAppendedScript)
    }
    return jsonResult({
      project: compactProject(project),
      ...(styleReferenceAssetIds === undefined ? {} : { styleReferenceAssetIds }),
      ...(concept === undefined ? {} : { conceptUpdated: true }),
    })
  },
})

const compactProject = (p: WireProject) => ({
  id: p.id,
  name: p.name,
  aspectRatio: p.aspectRatio,
  resolution: `${String(p.resolution.width)}x${String(p.resolution.height)}`,
  fps: p.fps,
  durationSec: p.durationSec,
  status: p.status,
  ...(p.styleGuide ? { styleGuide: p.styleGuide } : {}),
  ...(p.avoid ? { avoid: p.avoid } : {}),
  // 仕上げの音量（ADR-0060）。選んでいなければ出さない（自動）。
  ...(p.masteringMode === undefined || p.masteringMode === null ? {} : { masteringMode: p.masteringMode }),
})

const conceptOf = async (api: ApiClient, projectId: string): Promise<string> => {
  try {
    const script = await api.get(`/projects/${seg(projectId)}/script`, WireScript)
    return script.currentVersion?.content ?? ''
  } catch (error) {
    // 脚本がまだ無い作品は 404。
    if (error instanceof IxaApiError && error.status === 404) return ''
    throw error
  }
}

/** カメラのうち決まっている項目だけ。 */
const compactCamera = (camera: z.infer<typeof WireShot>['camera']) =>
  Object.fromEntries(Object.entries(camera).filter(([, value]) => value !== null))

export const getProjectTool = defineTool({
  name: 'get_project',
  risk: 'read',
  description:
    'Everything about a project in one compact JSON: settings, concept, music tracks (which one is master), ' +
    'characters, locations, and every shot in order with start/duration, description, mood, camera, location, cast, ' +
    'start-frame state (ready/drawing/missing), selected take, status and the transition into the next shot.',
  input: z.object({ projectId: Id }),
  handler: async ({ projectId }, { api }) => {
    const base = `/projects/${seg(projectId)}`
    const [project, concept, shots, tracks, characters, locations, posters, transitions] = await Promise.all([
      api.get(base, WireProject),
      conceptOf(api, projectId),
      api.get(`${base}/shots`, z.array(WireShot)),
      api.get(`${base}/music-tracks`, z.array(WireMusicTrack)),
      api.get(`${base}/characters`, z.array(WireCharacter)),
      api.get(`${base}/locations`, z.array(WireLocation)),
      api.get(`${base}/shot-posters`, z.array(WireShotPoster)),
      api.get(`${base}/transitions`, z.array(WireTransition)),
    ])
    const ordered = [...shots].sort((a, b) => a.order - b.order)
    const casts = await mapLimited(ordered, 6, (shot) =>
      api.get(`/shots/${seg(shot.id)}/characters`, z.array(WireShotCharacter)),
    )
    const characterName = new Map(characters.map((c) => [c.id, c.displayName]))
    const locationName = new Map(locations.map((l) => [l.id, l.name]))
    const posterOf = new Map(posters.map((p) => [p.shotId, p]))
    const transitionFrom = new Map(transitions.map((t) => [t.fromShotId, t]))
    return jsonResult({
      project: compactProject(project),
      concept,
      musicTracks: tracks.map((t) => ({ id: t.id, title: t.title, isMaster: t.isMaster ?? false })),
      characters: characters.map((c) => ({ id: c.id, name: c.name, displayName: c.displayName })),
      locations: locations.map((l) => ({ id: l.id, name: l.name, references: l.referenceAssetIds?.length ?? 0 })),
      shots: ordered.map((shot, i) => {
        const poster = posterOf.get(shot.id)
        const transition = transitionFrom.get(shot.id)
        return {
          id: shot.id,
          code: shot.code,
          startSec: round(shot.startSec),
          durationSec: round(shot.durationSec),
          // 速さと Take の使い始め（ADR-0050）。既定（1 倍・頭から）のときは出さない。
          ...(shot.speed === undefined || shot.speed === 1 ? {} : { speed: shot.speed }),
          ...(shot.sourceInSec === undefined || shot.sourceInSec === 0 ? {} : { sourceInSec: round(shot.sourceInSec) }),
          // Take の音（ADR-0060）。既定（音あり・1）のときは出さない。
          // 消音は選んだときだけ出す（null は自動: セリフのある Shot だけ鳴らす）。
          ...(shot.takeAudioMuted === undefined || shot.takeAudioMuted === null ? {} : { takeAudioMuted: shot.takeAudioMuted }),
          ...(shot.takeAudioVolume === undefined || shot.takeAudioVolume === 1 ? {} : { takeAudioVolume: shot.takeAudioVolume }),
          description: shot.description ?? '',
          ...(shot.mood === null ? {} : { mood: shot.mood }),
          camera: compactCamera(shot.camera),
          ...(shot.locationId === null ? {} : { location: locationName.get(shot.locationId) ?? shot.locationId }),
          cast: (casts[i] ?? []).map((c) => ({ name: characterName.get(c.characterId) ?? c.characterId, prominence: c.prominence })),
          startFrame: poster === undefined ? 'unknown' : poster.drawing ? 'drawing' : poster.hasStartFrame ? 'ready' : 'missing',
          selectedTakeId: shot.selectedTakeId,
          status: shot.status,
          ...(transition === undefined ? {} : { transitionToNext: { type: transition.type, durationSec: transition.durationSec ?? 0 } }),
        }
      }),
    })
  },
})
