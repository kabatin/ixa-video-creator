import {
  ProjectId as ProjectIdSchema,
  StoryboardDraftItemId as StoryboardDraftItemIdSchema,
  StoryboardDraftRunId as StoryboardDraftRunIdSchema,
  newId,
} from '@ixa/domain'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ShotStoryboardSection } from '@/components/workbench/inspector/shot-storyboard-section'
import type { StoryboardDraftApi, WireStoryboardDraftItem, WireStoryboardDraftRun } from '@/lib/storyboard-draft-api'
import { aWorkbenchShot, renderInWorkbench } from './workbench-fixture'

/**
 * Shot のインスペクターの「絵コンテ」（制作者 2026-10-03「絵コンテ自分で入力、編集することできない？ Shot の
 * インスペクターでも単品の絵コンテ情報見れるようになってて編集削除ができればよさそうかも」）。
 * 説明・雰囲気を書けて、消せて、この Shot の AI の案を「なぜこの絵か」つきで見て、その場で採用できる。
 */

const projectId = newId(ProjectIdSchema)
const run: WireStoryboardDraftRun = {
  id: newId(StoryboardDraftRunIdSchema),
  projectId,
  drafter: 'stub-storyboard-drafter',
  status: 'done',
  costUsd: 0,
  error: null,
  createdAt: '2026-10-03T00:00:00.000Z',
}
const shot = aWorkbenchShot(1, { description: '屋上で二人', mood: '静か' })
const itemOf = (overrides: Partial<WireStoryboardDraftItem> = {}): WireStoryboardDraftItem => ({
  id: newId(StoryboardDraftItemIdSchema),
  runId: run.id,
  shotId: shot.id,
  description: '夜明けの屋上、二人の背中',
  mood: '希望',
  reason: '曲の入りで世界を見せるため',
  adoptedAt: null,
  createdAt: '2026-10-03T00:00:00.000Z',
  ...overrides,
})
const apiWith = (item: WireStoryboardDraftItem | null): StoryboardDraftApi => ({
  getLatestDraft: vi.fn(() => Promise.resolve({ run: item === null ? null : run, items: item === null ? [] : [item] })),
  createDraft: vi.fn(),
  adopt: vi.fn(() =>
    Promise.resolve({ adopted: [], shots: [{ id: shot.id, code: shot.code, description: '夜明けの屋上、二人の背中', mood: '希望' }] }),
  ),
})

describe('ShotStoryboardSection', () => {
  it('説明と雰囲気の欄がある', () => {
    renderInWorkbench(<ShotStoryboardSection shot={shot} disabled={false} api={apiWith(null)} />, { shots: [shot] })
    expect(screen.getByLabelText<HTMLTextAreaElement>('説明').value).toBe('屋上で二人')
    expect(screen.getByLabelText<HTMLInputElement>('雰囲気').value).toBe('静か')
  })

  it('「消す」で説明と雰囲気をまとめて消す（確かめてから）', async () => {
    const { value } = renderInWorkbench(<ShotStoryboardSection shot={shot} disabled={false} api={apiWith(null)} />, {
      shots: [shot],
    })

    await userEvent.click(screen.getByRole('button', { name: '絵コンテを消す' }))
    expect(value.saveShot).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '消す' }))

    expect(value.saveShot).toHaveBeenCalledWith(shot.id, { description: '', mood: null })
  })

  it('この Shot の AI の案を「なぜこの絵か」つきで見せ、その場で採用できる', async () => {
    const api = apiWith(itemOf())
    const { value } = renderInWorkbench(<ShotStoryboardSection shot={shot} disabled={false} api={api} />, {
      shots: [shot],
      projectId,
    })

    expect(await screen.findByText('夜明けの屋上、二人の背中')).toBeInTheDocument()
    expect(screen.getByText(/なぜこの絵か: 曲の入りで世界を見せるため/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'この案にする' }))

    await waitFor(() => {
      expect(api.adopt).toHaveBeenCalledWith(projectId, run.id, [shot.id])
    })
    expect(value.applyAdoptedShots).toHaveBeenCalledWith([
      { id: shot.id, code: shot.code, description: '夜明けの屋上、二人の背中', mood: '希望' },
    ])
  })

  it('採用済みの案は「なぜこの絵か」だけを残す（同じ文を 2 度出さない）', async () => {
    renderInWorkbench(
      <ShotStoryboardSection
        shot={{ ...shot, description: '夜明けの屋上、二人の背中' }}
        disabled={false}
        api={apiWith(itemOf({ adoptedAt: '2026-10-03T01:00:00.000Z' }))}
      />,
      { shots: [shot], projectId },
    )

    expect(await screen.findByText(/なぜこの絵か: 曲の入りで世界を見せるため/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'この案にする' })).toBeNull()
  })
})
