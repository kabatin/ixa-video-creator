import { lyricCuesProblem, lyricLines } from '@ixa/domain'
import { z } from 'zod'
import { seg } from '../api-client.js'
import { defineTool, Id, jsonResult, round, ToolInputError } from '../tool-def.js'

/**
 * 歌詞（ADR-0033）。作品の歌詞・行ごとの歌い出しの秒・インストか（`PATCH /projects/{id}`）と、
 * 歌詞をフレーズごとのテロップにする（`POST /projects/{id}/clips/lyrics`。前に歌詞から置いたものだけ差し替える）。
 * 時刻の決まり（行の順に増える 0 以上の秒・行より多く付けない）は domain の `lyricCuesProblem` を読む。
 */

/** 歌詞の上限（字）。MV 1 曲なら十分。 */
const LYRICS_MAX = 20_000

const WireLyrics = z.object({
  lyrics: z.string().default(''),
  lyricCues: z.array(z.number()).default([]),
  instrumental: z.boolean().default(false),
})

const WirePlaced = z.object({
  clips: z.array(z.object({ id: z.string() })),
  replacedCount: z.number(),
  timedCount: z.number(),
  lineCount: z.number(),
})

export const SetLyricsInput = z.object({
  projectId: Id,
  lyrics: z.string().max(LYRICS_MAX).optional().describe('Whole lyrics, one phrase per line (blank lines ignored).'),
  lyricCues: z
    .array(z.number().min(0))
    .max(1000)
    .optional()
    .describe('Start second of each line on the timeline, in line order, strictly increasing. May cover only the first lines.'),
  instrumental: z.boolean().optional().describe('true = the song has no vocals.'),
  placeTelops: z
    .boolean()
    .default(false)
    .describe('Then place one telop per timed line (replaces telops placed from lyrics before; manual telops stay).'),
})

export const setLyricsTool = defineTool({
  name: 'set_lyrics',
  risk: 'write',
  description:
    'Set the project lyrics, the start second of each line (lyricCues) and the instrumental flag, and optionally ' +
    'turn timed lines into lyric telops (placeTelops). Lyric telops use the saved style named 歌詞 if it exists.',
  input: SetLyricsInput,
  handler: async ({ projectId, lyrics, lyricCues, instrumental, placeTelops }, { api }) => {
    // 送るのは丸めた秒なので、確かめも丸めた後の値で（丸めて重なる・逆転する時刻を通さない）。
    const cues = lyricCues?.map((cue) => round(cue))
    const patch = {
      ...(lyrics === undefined ? {} : { lyrics }),
      ...(cues === undefined ? {} : { lyricCues: cues }),
      ...(instrumental === undefined ? {} : { instrumental }),
    }
    if (Object.keys(patch).length === 0 && !placeTelops) {
      throw new ToolInputError('lyrics・lyricCues・instrumental のどれかを送るか、placeTelops: true にしてください')
    }
    if (cues !== undefined) {
      const problem = lyricCuesProblem(cues)
      if (problem !== null) throw new ToolInputError(`lyricCues: ${problem}`)
    }
    const project =
      Object.keys(patch).length === 0
        ? await api.get(`/projects/${seg(projectId)}`, WireLyrics)
        : await api.request('PATCH', `/projects/${seg(projectId)}`, WireLyrics, { body: patch })
    const placed = placeTelops
      ? await api.post(`/projects/${seg(projectId)}/clips/lyrics`, undefined, WirePlaced)
      : null
    const lines = lyricLines(project.lyrics)
    return jsonResult({
      lineCount: lines.length,
      timedCount: project.lyricCues.length,
      instrumental: project.instrumental,
      lines: lines.map((text, i) => ({ index: i, text, startSec: project.lyricCues[i] ?? null })),
      ...(placed === null
        ? {}
        : { telops: { placed: placed.clips.length, replaced: placed.replacedCount, clipIds: placed.clips.map((c) => c.id) } }),
    })
  },
})
