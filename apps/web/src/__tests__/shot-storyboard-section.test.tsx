import {
  ProjectId as ProjectIdSchema,
  StoryboardDraftItemId as StoryboardDraftItemIdSchema,
  StoryboardDraftRunId as StoryboardDraftRunIdSchema,
  newId,
} from '@ixa/domain'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
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
  camera: null,
  adoptedAt: null,
  createdAt: '2026-10-03T00:00:00.000Z',
  ...overrides,
})
/** 採用で入るカメラ（ADR-0043）。**応答に含まれないと画面に出ない**ので、偽の応答にも入れる。 */
const ADOPTED_CAMERA = {
  size: 'medium',
  angleH: null,
  angle: null,
  lensMm: null,
  movement: 'tilt',
  movementIntensity: 'moderate',
} as const

const apiWith = (item: WireStoryboardDraftItem | null): StoryboardDraftApi => ({
  getLatestDraft: vi.fn(() => Promise.resolve({ run: item === null ? null : run, items: item === null ? [] : [item] })),
  createDraft: vi.fn(),
  adopt: vi.fn(() =>
    Promise.resolve({
      adopted: [],
      shots: [{ id: shot.id, code: shot.code, description: '夜明けの屋上、二人の背中', mood: '希望', camera: ADOPTED_CAMERA }],
    }),
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
    // **カメラも渡す。** 落とすと、入っているのに画面だけ古いままになる（ADR-0043）。
    expect(value.applyAdoptedShots).toHaveBeenCalledWith([
      { id: shot.id, code: shot.code, description: '夜明けの屋上、二人の背中', mood: '希望', camera: ADOPTED_CAMERA },
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

/** レビューで見つけた 2 点。Shot を替えたら前の Shot の案を出さない。消すのに失敗したら理由を出す。 */
describe('ShotStoryboardSection: Shot を替えたとき・失敗したとき', () => {
  it('Shot を替えたら、読み直しが終わるまで前の Shot の案を出さない（違う Shot で採用しない）', async () => {
    const other = aWorkbenchShot(2, { description: '' })
    const api: StoryboardDraftApi = {
      getLatestDraft: vi
        .fn<StoryboardDraftApi['getLatestDraft']>()
        .mockResolvedValueOnce({ run, items: [itemOf()] })
        .mockReturnValue(new Promise(() => undefined)),
      createDraft: vi.fn(),
      adopt: vi.fn(),
    }
    const Switch = () => {
      const [current, setCurrent] = useState(shot)
      return (
        <>
          <button type="button" onClick={() => setCurrent(other)}>
            替える
          </button>
          <ShotStoryboardSection shot={current} disabled={false} api={api} />
        </>
      )
    }
    renderInWorkbench(<Switch />, { shots: [shot, other], projectId })
    expect(await screen.findByText('夜明けの屋上、二人の背中')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '替える' }))

    expect(screen.queryByText('夜明けの屋上、二人の背中')).toBeNull()
  })

  it('「消す」に失敗したら理由を出す', async () => {
    renderInWorkbench(<ShotStoryboardSection shot={shot} disabled={false} api={apiWith(null)} />, {
      shots: [shot],
      saveShot: vi.fn(() => Promise.reject(new Error('保存できません'))),
    })

    await userEvent.click(screen.getByRole('button', { name: '絵コンテを消す' }))
    await userEvent.click(screen.getByRole('button', { name: '消す' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('保存できません')
  })
})
