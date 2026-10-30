import { ProjectEditOrigin, ProjectId, SfxJobId, newId, type ProjectEvent } from '@ixa/domain'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EDIT_ORIGIN_HEADER, isForeignEdit, newEditOrigin } from '@/lib/edit-origin'
import { createRequester } from '@/lib/requester'
import { WireTimelineClip } from '@/lib/timeline-api'

/**
 * 作品の書き換えの合図（`project.edited`）。MCP や別の画面の書き込みだけを読み直し、
 * 自分の書き込みは読み直さない（制作者 2026-10-30「リロードしたら反映された」）。
 */

const edited = (origin: string | null): ProjectEvent => ({
  type: 'project.edited',
  projectId: newId(ProjectId),
  at: '2026-10-30T00:00:00.000Z',
  origin,
})

describe('isForeignEdit', () => {
  it('印の無い書き込み（MCP・エージェント）は読み直す', () => {
    expect(isForeignEdit(edited(null), 'tab_a')).toBe(true)
  })

  it('別の画面の書き込みは読み直し、自分の書き込みは読み直さない', () => {
    expect(isForeignEdit(edited('tab_b'), 'tab_a')).toBe(true)
    expect(isForeignEdit(edited('tab_a'), 'tab_a')).toBe(false)
  })

  it('自分の印が無い（サーバ側）なら、印の無い書き込みも読み直す', () => {
    expect(isForeignEdit(edited(null), null)).toBe(true)
  })

  it('書き換えの合図でない出来事は対象外', () => {
    const status: ProjectEvent = {
      type: 'sfx_job.status',
      projectId: newId(ProjectId),
      at: '2026-10-30T00:00:00.000Z',
      jobId: newId(SfxJobId),
      status: 'running',
      timelineClipId: null,
      error: null,
    }
    expect(isForeignEdit(status, 'tab_a')).toBe(false)
  })
})

describe('newEditOrigin', () => {
  it('API が受け付ける形で、毎回ちがう', () => {
    const a = newEditOrigin()
    expect(ProjectEditOrigin.safeParse(a).success).toBe(true)
    expect(newEditOrigin()).not.toBe(a)
  })
})

describe('Requester が書き込みに画面の印を付ける', () => {
  const fetchMock = vi.fn()
  afterEach(() => {
    vi.unstubAllGlobals()
    fetchMock.mockReset()
  })

  const clip = {
    id: newId(ProjectId),
    projectId: newId(ProjectId),
    track: 'TEXT',
    startSec: 0,
    durationSec: 1,
    layer: 0,
    content: { type: 'text', templateKey: 'lower-third', params: {} },
    opacity: 1,
    createdAt: '2026-10-30T00:00:00.000Z',
  }

  it('PATCH には付け、GET には付けない', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ success: true, data: clip }), { status: 200 })))
    const requester = createRequester('http://api.test', { editOrigin: 'tab_a' })

    await requester.patch('/clips/x', {}, WireTimelineClip)
    await requester.get('/clips/x', WireTimelineClip)

    const headerOf = (call: number): unknown => (fetchMock.mock.calls[call]?.[1] as RequestInit).headers
    expect(headerOf(0)).toMatchObject({ [EDIT_ORIGIN_HEADER]: 'tab_a' })
    expect(headerOf(1)).not.toHaveProperty(EDIT_ORIGIN_HEADER)
  })
})
