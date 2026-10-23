import { basename, extname, isAbsolute } from 'node:path'
import { z } from 'zod'
import { IxaApiError, seg, type ApiClient } from '../api-client.js'
import { uploadLocalFile } from '../lib/media-io.js'
import { assertListed } from '../lib/project-scope.js'
import { summarizeAnalysis } from '../lib/music-summary.js'
import { WireAnalysis, WireAnalysisFailure, WireMusicTrack } from '../wire.js'
import { defineTool, Id, jsonResult, ToolInputError } from '../tool-def.js'

/** 曲を上げる・主役の曲を決める・曲の構造を見る。 */

const WireAnalysisQueued = z.object({ queued: z.boolean() })

const startAnalysis = (api: ApiClient, trackId: string) =>
  api.post(`/music-tracks/${seg(trackId)}/analysis`, undefined, WireAnalysisQueued)

export const uploadMusicTool = defineTool({
  name: 'upload_music',
  risk: 'write',
  description:
    'Upload a local audio file (mp3/wav/m4a/aac/flac/ogg) as a music track of the project and start the beat analysis. ' +
    'By default it becomes the master track (the song the video is cut to). ' +
    'Then wait with {kind:"analysis", id: musicTrackId} and read music_overview.',
  input: z.object({
    projectId: Id,
    filePath: z.string().min(1).refine(isAbsolute, 'absolute path required'),
    title: z.string().min(1).max(200).optional().describe('Defaults to the file name.'),
    setAsMaster: z.boolean().default(true),
  }),
  handler: async (args, { api, workspaceId }) => {
    const mediaAssetId = await uploadLocalFile(api, args.filePath, {
      workspaceId,
      projectId: args.projectId,
      kind: 'audio',
    })
    const track = await api.post(
      `/projects/${seg(args.projectId)}/music-tracks`,
      {
        mediaAssetId,
        title: args.title ?? basename(args.filePath, extname(args.filePath)),
        isMaster: args.setAsMaster,
      },
      WireMusicTrack,
    )
    const analysis = await startAnalysis(api, track.id)
    return jsonResult({
      musicTrackId: track.id,
      mediaAssetId,
      isMaster: track.isMaster ?? false,
      analysisQueued: analysis.queued,
      next: { tool: 'wait', jobs: [{ kind: 'analysis', id: track.id }] },
    })
  },
})

export const setMasterTrackTool = defineTool({
  name: 'set_master_track',
  risk: 'settings',
  description:
    'Make a music track the master (the song the video follows) and (re)start its beat analysis unless it already exists. ' +
    'Use after generate_music succeeds (pick one of its musicTrackIds). Not undoable when the project had no master yet.',
  input: z.object({ projectId: Id, musicTrackId: Id, analyze: z.boolean().default(true) }),
  handler: async ({ projectId, musicTrackId, analyze }, { api }) => {
    await assertTrackInProject(api, projectId, musicTrackId)
    const tracks = await api.post(`/music-tracks/${seg(musicTrackId)}/set-master`, undefined, z.array(WireMusicTrack))
    const analysisQueued = analyze ? (await startAnalysis(api, musicTrackId)).queued : false
    return jsonResult({
      tracks: tracks.map((t) => ({ id: t.id, title: t.title, isMaster: t.isMaster ?? false })),
      analysisQueued,
      ...(analysisQueued ? { next: { tool: 'wait', jobs: [{ kind: 'analysis', id: musicTrackId }] } } : {}),
    })
  },
})

const projectTracks = (api: ApiClient, projectId: string) =>
  api.get(`/projects/${seg(projectId)}/music-tracks`, z.array(WireMusicTrack))

/** 曲がこの作品のものか（`/music-tracks/{id}` の口は ID だけで動く）。 */
const assertTrackInProject = (api: ApiClient, projectId: string, trackId: string) =>
  assertListed(api, `/projects/${seg(projectId)}/music-tracks`, [trackId], '曲', WireMusicTrack)

const masterTrackId = async (api: ApiClient, projectId: string): Promise<string> => {
  const tracks = await projectTracks(api, projectId)
  const master = tracks.find((t) => t.isMaster === true) ?? (tracks.length === 1 ? tracks[0] : undefined)
  if (master === undefined) {
    throw new ToolInputError(
      tracks.length === 0
        ? 'この作品には曲がありません。generate_music か upload_music を先に'
        : 'master track がありません。set_master_track で決めるか musicTrackId を指定してください',
    )
  }
  return master.id
}

/** 解析を取る。まだなら null と、失敗していればその文。 */
export const fetchAnalysis = async (
  api: ApiClient,
  trackId: string,
): Promise<{ readonly analysis: WireAnalysis | null; readonly failure: string | null }> => {
  try {
    return { analysis: await api.get(`/music-tracks/${seg(trackId)}/analysis`, WireAnalysis), failure: null }
  } catch (error) {
    if (!(error instanceof IxaApiError) || error.status !== 404) throw error
  }
  const failure = await api.get(`/music-tracks/${seg(trackId)}/analysis/failure`, WireAnalysisFailure)
  return { analysis: null, failure: failure?.message ?? null }
}

/** 指定が無ければ主役の曲。指定があれば、この作品の曲かを確かめてから。 */
export const resolveTrackId = async (api: ApiClient, projectId: string, trackId: string | undefined): Promise<string> => {
  if (trackId === undefined) return masterTrackId(api, projectId)
  await assertTrackInProject(api, projectId, trackId)
  return trackId
}

export const musicOverviewTool = defineTool({
  name: 'music_overview',
  risk: 'read',
  description:
    'Summarized structure of the master track (or musicTrackId): duration, BPM, bar length, sections with times ' +
    '(section labels are often unreliable — beats/downbeats are accurate), energy peaks, drops, and phrase starts ' +
    '(every 4 bars). Use these times to decide cut points for plan_shots. includeDownbeats adds every bar start.',
  input: z.object({
    projectId: Id,
    musicTrackId: Id.optional(),
    includeDownbeats: z.boolean().default(false),
  }),
  handler: async (args, { api }) => {
    const trackId = await resolveTrackId(api, args.projectId, args.musicTrackId)
    const { analysis, failure } = await fetchAnalysis(api, trackId)
    if (analysis === null) {
      return jsonResult({
        musicTrackId: trackId,
        analysis: failure === null ? 'not ready (still analysing, or never started: call set_master_track)' : 'failed',
        ...(failure === null ? {} : { error: failure }),
      })
    }
    return jsonResult({
      musicTrackId: trackId,
      ...summarizeAnalysis(analysis, { includeDownbeats: args.includeDownbeats }),
    })
  },
})
