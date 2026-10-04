import { ProjectId, RenderJobId } from '@ixa/domain'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RenderPanel } from '@/components/render-panel'
import type { RenderWatch } from '@/components/workbench/use-render-watch'
import type { RenderApi } from '@/lib/render-api'
import type { RenderRangeChoice } from '@/lib/render-range'
import type { TimelineIssueView } from '@/lib/timeline-issues'
import { PROJECT_ID } from './fixtures'

/**
 * 選んだ Shot だけを書き出す（制作者 2026-10-02「途中までを誰かに見せたい時のために選択した Shot だけを動画として出力」）。
 * Shot をチェックして開けば「選んだ Shot だけ」が最初から選ばれている。全体へ戻せる。
 */

const projectId = ProjectId.parse(PROJECT_ID)
const JOB_ID = RenderJobId.parse('01ARZ3NDEKTSV4RRFFQ69G5FC0')

const watch: RenderWatch = {
  jobs: [],
  active: [],
  error: null,
  note: null,
  nowMs: null,
  timeoutMs: 60_000,
  refresh: async () => {},
  watchedJobId: null,
  watchJob: () => {},
}

const range = (patch: Partial<RenderRangeChoice> = {}): RenderRangeChoice => ({
  scope: { type: 'range', start: 8, end: 16 },
  label: 'CUT-02〜CUT-03',
  span: '0:08.00 – 0:16.00（8.00s）',
  extraNote: null,
  blockingIssueCount: 0,
  warningIssueCount: 0,
  preferred: true,
  ...patch,
})

const anError: TimelineIssueView = { severity: 'error', code: 'shot_overlap', message: '重なり' }

const panel = (choice: RenderRangeChoice | null, blockingIssueCount = 0) => {
  const startRender = vi.fn<RenderApi['startRender']>().mockResolvedValue({ kind: 'accepted', renderJobId: JOB_ID, warnings: [] })
  const api: RenderApi = { startRender, getRenderJob: vi.fn(), listRenderJobs: vi.fn() }
  render(
    <RenderPanel
      projectId={projectId}
      initialJobs={[]}
      jobsError={null}
      issues={Array.from({ length: blockingIssueCount }, () => anError)}
      timelineDurationSec={60}
      watch={watch}
      api={api}
      range={choice}
      folderApi={{
        getRenderFolder: () => Promise.resolve({ location: '~/Movies/ixa-video-creator/x', canOpen: true }),
        openRenderFolder: vi.fn(),
      }}
    />,
  )
  return startRender
}

const start = () => screen.getByRole('button', { name: /^書き出す/ })

describe('書き出す範囲', () => {
  it('Shot をチェックして開いたら、選んだ Shot だけが選ばれていて、範囲付きで送る', async () => {
    const startRender = panel(range())

    expect(screen.getByRole('radio', { name: /選んだ Shot だけ/ })).toBeChecked()
    expect(screen.getByText(/CUT-02〜CUT-03/)).toBeTruthy()
    fireEvent.click(start())

    await waitFor(() => {
      expect(startRender).toHaveBeenCalledWith(projectId, expect.any(String), { type: 'range', start: 8, end: 16 })
    })
  })

  it('全体へ戻せば範囲を付けずに送る', async () => {
    const startRender = panel(range())

    fireEvent.click(screen.getByRole('radio', { name: /全体/ }))
    fireEvent.click(start())

    await waitFor(() => {
      expect(startRender).toHaveBeenCalledWith(projectId, expect.any(String), undefined)
    })
  })

  it('チェックせずに開いたら全体が選ばれている。間に入る Shot を知らせる', () => {
    panel(range({ preferred: false, extraNote: '間の CUT-03 も入ります' }))

    expect(screen.getByRole('radio', { name: /全体/ })).toBeChecked()
    expect(screen.getByText('間の CUT-03 も入ります')).toBeTruthy()
  })

  it('範囲の外の指摘では止めない（範囲を選んでいれば、範囲で数えた件数を見る）', () => {
    panel(range({ blockingIssueCount: 0 }), 3)

    expect(start()).not.toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: /全体/ }))
    expect(start()).toBeDisabled()
  })

  it('Shot を選んでいなければ「全体」だけ（選んだ Shot の選択肢は出さない）', () => {
    panel(null)

    expect(screen.getByRole('radio', { name: /全体/ })).toBeChecked()
    expect(screen.queryByRole('radio', { name: /選んだ Shot だけ/ })).toBeNull()
  })
})
