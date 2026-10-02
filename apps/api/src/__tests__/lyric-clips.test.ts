import { OpenAPIHono } from '@hono/zod-openapi'
import {
  LYRIC_STYLE_NAME,
  LYRIC_TELOP_LAYER,
  TextStyleId,
  TimelineClip,
  TimelineClipId,
  newId,
  type Project,
} from '@ixa/domain'
import { aShot, createInMemoryShotRepository } from '@ixa/generation/testing'
import { describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import { lyricClipRoutes } from '../routes/lyric-clips.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { createInMemoryTextStyleRepository } from './in-memory-text-style-repository.js'
import { createInMemoryTimelineClipRepository } from './in-memory-timeline-repositories.js'

/**
 * 歌詞をテロップにする（ADR-0033。制作者 2026-10-01「1 フレーズごとにテロップを自動生成」）。
 * フレーズごとに TEXT 帯の歌詞の層へ置き、置き直すと前に歌詞から置いたテロップを差し替える（手で置いたものは残す）。
 */

type Placed = { clips: { startSec: number; durationSec: number; layer: number; content: { params: Record<string, unknown> } }[]; replacedCount: number; timedCount: number; lineCount: number }
type Ok<T> = { success: true; data: T }
type Err = { success: false; error: string }

const build = (options: {
  readonly project?: Partial<Project>
  readonly withShots?: boolean
  readonly clips?: (projectId: Project['id']) => readonly TimelineClip[]
  readonly lyricStyle?: boolean
} = {}) => {
  const project = { ...aProject(), lyrics: '一行目\n二行目\n三行目', lyricCues: [1, 3], ...options.project }
  const shots = createInMemoryShotRepository(
    options.withShots === false ? [] : [aShot(project.id, { startSec: 0, durationSec: 10 })],
  )
  const timelineClips = createInMemoryTimelineClipRepository(options.clips?.(project.id) ?? [])
  const textStyles = createInMemoryTextStyleRepository(
    options.lyricStyle === true
      ? [
          {
            id: newId(TextStyleId),
            projectId: project.id,
            name: LYRIC_STYLE_NAME,
            style: { color: '#FFD100' },
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]
      : [],
  )
  const app = new OpenAPIHono({ defaultHook: validationHook })
  app.route(
    '/',
    lyricClipRoutes({
      projects: createInMemoryProjectRepository([project]),
      shots,
      timelineClips,
      textStyles,
    }),
  )
  registerErrorHandlers(app, createLogger('silent'))
  const place = () => app.request(`/projects/${project.id}/clips/lyrics`, { method: 'POST' })
  return { project, timelineClips, place }
}

const handPlaced = (projectId: Project['id'], params: Record<string, unknown>, layer = 0) =>
  TimelineClip.parse({
    id: newId(TimelineClipId),
    projectId,
    track: 'TEXT',
    startSec: 5,
    durationSec: 1,
    layer,
    content: { type: 'text', templateKey: 'plain', params },
    opacity: 1,
    createdAt: new Date(),
  })

describe('POST /projects/:id/clips/lyrics', () => {
  it('時刻の付いたフレーズを、歌詞の層に次のフレーズの頭まで置く（何行目かの印を付ける）', async () => {
    const f = build()

    const res = await f.place()

    expect(res.status).toBe(200)
    const data = ((await res.json()) as Ok<Placed>).data
    expect(data.clips.map((clip) => [clip.startSec, clip.durationSec])).toEqual([
      [1, 2],
      [3, 6],
    ])
    expect(data.clips.every((clip) => clip.layer === LYRIC_TELOP_LAYER)).toBe(true)
    expect(data.clips.map((clip) => clip.content.params['lyricLine'])).toEqual([0, 1])
    expect(data.clips.map((clip) => clip.content.params['text'])).toEqual(['一行目', '二行目'])
    expect(data).toMatchObject({ timedCount: 2, lineCount: 3, replacedCount: 0 })
  })

  it('置き直すと、前に歌詞から置いたテロップだけを差し替える（手で置いたものは残す）', async () => {
    const g = build({
      clips: (projectId) => [
        handPlaced(projectId, { text: '手で置いた' }),
        handPlaced(projectId, { text: '古い歌詞', lyricLine: 0 }, LYRIC_TELOP_LAYER),
      ],
    })

    const data = ((await (await g.place()).json()) as Ok<Placed>).data

    expect(data.replacedCount).toBe(1)
    const texts = g.timelineClips.snapshot().map((clip) =>
      clip.content.type === 'text' ? (clip.content.params as { text: string }).text : '',
    )
    expect(texts).toContain('手で置いた')
    expect(texts).not.toContain('古い歌詞')
  })

  it('保存した「歌詞」のスタイルがあれば、その見た目で置く', async () => {
    const f = build({ lyricStyle: true })

    const data = ((await (await f.place()).json()) as Ok<Placed>).data

    expect(data.clips[0]?.content.params).toMatchObject({ style: { color: '#FFD100' } })
    expect(typeof data.clips[0]?.content.params['styleId']).toBe('string')
  })

  it('時刻がまだ 1 つも無ければ 422（聴きながら合わせる）', async () => {
    const f = build({ project: { lyricCues: [] } })

    const res = await f.place()

    expect(res.status).toBe(422)
    expect(((await res.json()) as Err).error).toContain('合わせ')
  })

  it('Shot が無ければ 422（置く場所が無い）', async () => {
    const f = build({ withShots: false })

    expect((await f.place()).status).toBe(422)
  })
})
