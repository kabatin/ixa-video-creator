import { ProjectId } from '@ixa/domain'
import { act, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRenderWatch } from '@/components/workbench/use-render-watch'
import { WireRenderJob, type RenderApi } from '@/lib/render-api'
import { PROJECT_ID } from './fixtures'

/**
 * 走っている書き出しの見守り（F2）。
 *
 * 追跡が**ダイアログの中身より長生きする**ことがこのフックの存在理由。
 * 以前は書き出しダイアログを閉じると `RenderDialogBody` ごと消え、ポーリングが止まり、
 * 「いま書き出している」がどこにも残らなかった。30 分かかる処理でそれをやると、
 * 終わったのか動いているのかを確かめる手段が無くなる。
 */

const RENDER_JOB_ID = '01ARZ3NDEKTSV4RRFFQ69G5FC0'

const projectId = ProjectId.parse(PROJECT_ID)

const aJob = (status: string, progress = 0.2): WireRenderJob =>
  WireRenderJob.parse({
    id: RENDER_JOB_ID,
    projectId: PROJECT_ID,
    scope: { type: 'full' },
    preset: 'master_1080p',
    status,
    progress,
    outputAssetId: null,
    error: null,
    createdAt: '2026-09-17T02:00:00.000Z',
    finishedAt: status === 'succeeded' ? '2026-09-17T02:05:00.000Z' : null,
  })

const INTERVAL_MS = 1_000
const TIMEOUT_MS = 10_000

const fakeApi = (listRenderJobs: RenderApi['listRenderJobs']): RenderApi => ({
  startRender: vi.fn(),
  getRenderJob: vi.fn(),
  listRenderJobs,
})

/**
 * フックは「ダイアログの外」に置く。中身（`open` の枝）だけが消える。
 * **フックを中身の側に置かない。** それが直そうとしている壊れ方そのもの。
 */
const Host = ({ api }: { readonly api: RenderApi }) => {
  const watch = useRenderWatch({
    projectId,
    api,
    intervalMs: INTERVAL_MS,
    timeoutMs: TIMEOUT_MS,
  })
  const [open, setOpen] = useState(true)

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setOpen(false)
        }}
      >
        ダイアログを閉じる
      </button>
      <p data-testid="active">{String(watch.active.length)}</p>
      <p data-testid="status">{watch.jobs?.[0]?.status ?? '読めていない'}</p>
      <p data-testid="note">{watch.note ?? 'なし'}</p>
      <p data-testid="error">{watch.error ?? 'なし'}</p>
      {open && <p>ダイアログの中身</p>}
    </div>
  )
}

const tick = async (ms: number): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('走っている書き出しの見守り', () => {
  it('ダイアログの中身が消えても追跡が続く', async () => {
    const list = vi
      .fn<RenderApi['listRenderJobs']>()
      .mockResolvedValueOnce([aJob('rendering', 0.1)])
      .mockResolvedValueOnce([aJob('rendering', 0.5)])
      .mockResolvedValue([aJob('succeeded', 1)])

    render(<Host api={fakeApi(list)} />)
    await tick(0)
    expect(screen.getByTestId('active')).toHaveTextContent('1')

    // 中身を消す＝ダイアログを閉じた状態。フックは Host 側に残る。
    act(() => {
      screen.getByRole('button', { name: 'ダイアログを閉じる' }).click()
    })
    expect(screen.queryByText('ダイアログの中身')).toBeNull()

    await tick(INTERVAL_MS)
    expect(screen.getByTestId('status')).toHaveTextContent('rendering')
    await tick(INTERVAL_MS)
    expect(screen.getByTestId('status')).toHaveTextContent('succeeded')
    expect(screen.getByTestId('active')).toHaveTextContent('0')
  })

  it('終わったら自分で止まる。叩き続けない', async () => {
    const list = vi
      .fn<RenderApi['listRenderJobs']>()
      .mockResolvedValueOnce([aJob('queued')])
      .mockResolvedValue([aJob('succeeded', 1)])

    render(<Host api={fakeApi(list)} />)
    await tick(0)
    await tick(INTERVAL_MS)
    const callsWhenSettled = list.mock.calls.length

    await tick(INTERVAL_MS * 5)
    expect(list.mock.calls.length).toBe(callsWhenSettled)
  })

  /** 「上限まで待った」を「終わった」と混ぜない（lessons L-015）。 */
  it('上限まで待っても終わらなければ、諦めたことを残す', async () => {
    const list = vi.fn<RenderApi['listRenderJobs']>().mockResolvedValue([aJob('rendering')])

    render(<Host api={fakeApi(list)} />)
    await tick(0)
    await tick(TIMEOUT_MS + INTERVAL_MS)

    expect(screen.getByTestId('note')).toHaveTextContent('timeout')
    expect(screen.getByTestId('active')).toHaveTextContent('1')
  })

  /** 一覧を空に畳まない。読めなくなったことを残す。 */
  it('引き直せなくなったら理由を残し、止まったことを分けて出す', async () => {
    const list = vi
      .fn<RenderApi['listRenderJobs']>()
      .mockResolvedValueOnce([aJob('rendering')])
      .mockRejectedValue(new Error('つながりません'))

    render(<Host api={fakeApi(list)} />)
    await tick(0)
    await tick(INTERVAL_MS)

    expect(screen.getByTestId('note')).toHaveTextContent('failed')
    expect(screen.getByTestId('error')).toHaveTextContent('つながりません')
    expect(screen.getByTestId('status')).toHaveTextContent('rendering')
  })
})
