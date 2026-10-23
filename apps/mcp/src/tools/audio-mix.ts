import { DuckingSettings, MusicEndSec, ReadingEntry, TelopHighlightSettings, UpdateMusicTrackPatch } from '@ixa/domain'
import { z } from 'zod'
import { seg, type ApiClient } from '../api-client.js'
import { defineTool, Id, jsonResult, ToolInputError } from '../tool-def.js'
import { assertListed } from '../lib/project-scope.js'
import { resolveTrackId } from './music.js'

/**
 * 音の仕上げ（ADR-0039）。曲の音量・開始位置・フェード・終わり（`PATCH /music-tracks/{id}`）と、
 * 作品の音の設定（`GET/PUT /projects/{id}/audio-settings`: ダッキング・話している字の強調・読み辞書）。
 *
 * 音の設定の PUT は丸ごと置き換えなので、今の値を読んで変えた欄だけ重ねる（読み辞書を落とさない）。
 */

export const WireAudioSettings = z.object({
  readingDictionary: z.array(ReadingEntry),
  ducking: DuckingSettings,
  telopHighlight: TelopHighlightSettings,
})
export type WireAudioSettings = z.infer<typeof WireAudioSettings>

export const getAudioSettings = (api: ApiClient, projectId: string) =>
  api.get(`/projects/${seg(projectId)}/audio-settings`, WireAudioSettings)

export const putAudioSettings = (api: ApiClient, projectId: string, settings: WireAudioSettings) =>
  api.request('PUT', `/projects/${seg(projectId)}/audio-settings`, WireAudioSettings, { body: settings })

const WireTrack = z.object({
  id: z.string(),
  title: z.string(),
  isMaster: z.boolean().optional(),
  offsetSec: z.number().optional(),
  volume: z.number().optional(),
  fadeInSec: z.number().optional(),
  fadeOutSec: z.number().optional(),
  endSec: z.number().nullable().optional(),
})

const MusicChange = UpdateMusicTrackPatch.omit({ title: true }).extend({
  musicTrackId: Id.optional().describe('Default: the master track.'),
  endSec: MusicEndSec.nullable().optional().describe('Stop the song here (seconds in the song); null = natural end.'),
})

export const EditAudioInput = z.object({
  projectId: Id,
  music: MusicChange.optional().describe('volume 0–2, offsetSec (where the song starts on the timeline), fadeInSec/fadeOutSec, endSec.'),
  ducking: DuckingSettings.partial().optional().describe('Lower the music while narration plays: enabled, depthDb 0–24 (6 weak, 10 medium, 16 strong), attackSec, releaseSec 0–2.'),
  telopHighlight: TelopHighlightSettings.partial().optional().describe('Colour the narration caption character being spoken: enabled, color #RRGGBB.'),
})

const trackSummary = (t: z.infer<typeof WireTrack>) => ({
  id: t.id,
  title: t.title,
  isMaster: t.isMaster ?? false,
  offsetSec: t.offsetSec ?? 0,
  volume: t.volume ?? 1,
  fadeInSec: t.fadeInSec ?? 0,
  fadeOutSec: t.fadeOutSec ?? 0,
  endSec: t.endSec ?? null,
})

export const editAudioTool = defineTool({
  name: 'edit_audio',
  risk: 'write',
  description:
    'Mix settings: the music track (volume, offsetSec, fades, endSec) and the project audio settings (ducking under ' +
    'narration, highlighting the spoken caption character). Send only what changes; with nothing, it shows the current ' +
    'values. Ducking and telopHighlight changes are not undoable.',
  input: EditAudioInput,
  handler: async ({ projectId, music, ducking, telopHighlight }, { api }) => {
    if (music !== undefined) {
      const { musicTrackId, ...patch } = music
      if (Object.keys(patch).length === 0) throw new ToolInputError('music: 変える欄がありません')
      if (musicTrackId !== undefined) await assertListed(api, `/projects/${seg(projectId)}/music-tracks`, [musicTrackId], '曲')
      const trackId = await resolveTrackId(api, projectId, musicTrackId)
      await api.request('PATCH', `/music-tracks/${seg(trackId)}`, WireTrack, { body: patch })
    }
    const current = await getAudioSettings(api, projectId)
    const settings =
      ducking === undefined && telopHighlight === undefined
        ? current
        : await putAudioSettings(api, projectId, {
            ...current,
            ducking: DuckingSettings.parse({ ...current.ducking, ...ducking }),
            telopHighlight: TelopHighlightSettings.parse({ ...current.telopHighlight, ...telopHighlight }),
          })
    const tracks = await api.get(`/projects/${seg(projectId)}/music-tracks`, z.array(WireTrack))
    return jsonResult({
      tracks: tracks.map(trackSummary),
      ducking: settings.ducking,
      telopHighlight: settings.telopHighlight,
    })
  },
})
