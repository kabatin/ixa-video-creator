import { MediaAssetId, ProjectId, RenderJobId } from '@ixa/domain'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RenderPanel } from '@/components/render-panel'
import type { RenderWatch } from '@/components/workbench/use-render-watch'
import { WireRenderJob, type RenderApi } from '@/lib/render-api'
import type { RenderFolderApi } from '@/lib/render-folder-api'
import type { TimelineIssueView } from '@/lib/timeline-issues'
import { PROJECT_ID } from './fixtures'

/**
 * 書き出し画面（制作者 2026-10-03「書き出し画面で生成された動画があるフォルダを開く導線が欲しい。UI/UX が雑な印象が
 * あるのでついでに綺麗にしておいて」）。左で範囲・画質・書き出す前の確認・書き出す、右でこれまでの書き出し。
 */

const projectId = ProjectId.parse(PROJECT_ID)
const JOB_ID = RenderJobId.parse('01ARZ3NDEKTSV4RRFFQ69G5FC0')
const OUTPUT_ID = MediaAssetId.parse('01ARZ3NDEKTSV4RRFFQ69G5FC1')

const done = WireRenderJob.parse({
  id: JOB_ID,
  projectId: PROJECT_ID,
  scope: { type: 'full' },
  preset: 'preview_720p',
  status: 'succeeded',
  progress: 1,
  outputAssetId: OUTPUT_ID,
  error: null,
  createdAt: '2026-10-02T13:52:00.000Z',
  finishedAt: '2026-10-02T13:54:03.000Z',
})

const watchOf = (jobs: readonly WireRenderJob[]): RenderWatch => ({
  jobs,
  active: [],
  error: null,
  note: null,
  nowMs: Date.parse('2026-10-02T14:00:00.000Z'),
  timeoutMs: 60_000,
  refresh: async () => {},
  watchedJobId: null,
  watchJob: () => {},
})

const issue = (severity: 'error' | 'warning'): TimelineIssueView => ({ severity, code: 'take_not_selected', message: '指摘' })

const setup = (
  options: {
    issues?: readonly TimelineIssueView[] | null
    jobs?: readonly WireRenderJob[]
    canOpen?: boolean
    openFails?: boolean
  } = {},
) => {
  const startRender = vi
    .fn<RenderApi['startRender']>()
    .mockResolvedValue({ kind: 'accepted', renderJobId: JOB_ID, warnings: [] })
  const api: RenderApi = { startRender, getRenderJob: vi.fn(), listRenderJobs: vi.fn() }
  const openRenderFolder = vi.fn<RenderFolderApi['openRenderFolder']>(() =>
    options.openFails === true
      ? Promise.reject(new Error('Finder を開けませんでした'))
      : Promise.resolve({ location: '~/Movies/ixa-video-creator/ぼくははると', copied: 1, failed: [] }),
  )
  const folderApi: RenderFolderApi = {
    getRenderFolder: vi.fn(() =>
      Promise.resolve({ location: '~/Movies/ixa-video-creator/ぼくははると', canOpen: options.canOpen ?? true }),
    ),
    openRenderFolder,
  }
  const resolveOutputUrl = vi.fn(() => Promise.resolve('http://example.test/video.mp4'))
  render(
    <RenderPanel
      projectId={projectId}
      initialJobs={[]}
      jobsError={null}
      issues={options.issues === undefined ? [] : options.issues}
      timelineDurationSec={250.92}
      watch={watchOf(options.jobs ?? [done])}
      api={api}
      folderApi={folderApi}
      resolveOutputUrl={resolveOutputUrl}
    />,
  )
  return { startRender, openRenderFolder, resolveOutputUrl }
}

const startButton = () => screen.getByRole('button', { name: /^書き出す/ })

describe('書き出す前の確認', () => {
  it('指摘が無ければ「問題はありません」。書き出せる', () => {
    setup({ issues: [] })
    expect(screen.getByText(/問題はありません/)).toBeTruthy()
    expect(startButton()).not.toBeDisabled()
  })

  it('警告だけなら「書き出せます」と出し、止めない', () => {
    setup({ issues: [issue('warning'), issue('warning')] })
    // 1 行の要約が先頭。明細（「詳しく見る」の中）にも status があるので先頭を見る。
    const [summary] = within(screen.getByRole('region', { name: '書き出す前の確認' })).getAllByRole('status')
    expect(summary?.textContent).toMatch(/警告 2 件。書き出せます/)
    expect(startButton()).not.toBeDisabled()
  })

  it('書き出せない指摘があればボタンを止め、件数を出す', () => {
    setup({ issues: [issue('error'), issue('warning')] })
    expect(screen.getByText(/書き出せない指摘が 1 件/)).toBeTruthy()
    expect(startButton()).toBeDisabled()
  })

  it('確認できていなければ、そう出す（問題なしに見せない）', () => {
    setup({ issues: null })
    expect(screen.getByText(/確認できていません/)).toBeTruthy()
  })

  it('長さは長い尺の書式（分と秒、秒を併記）で出す', () => {
    setup()
    expect(screen.getByText(/4:10\.92/)).toBeTruthy()
  })
})

describe('画質', () => {
  it('カードで選び、選んだ画質で書き出す', async () => {
    const { startRender } = setup()

    fireEvent.click(screen.getByRole('radio', { name: /マスター（1080p）/ }))
    fireEvent.click(startButton())

    await waitFor(() => {
      expect(startRender).toHaveBeenCalledWith(projectId, 'master_1080p', undefined, { normalizeLoudness: true })
    })
  })
})

describe('フォルダ', () => {
  it('「フォルダを開く」で開き、保存先を出す', async () => {
    const { openRenderFolder } = setup()

    expect(await screen.findByText('保存先 ~/Movies/ixa-video-creator/ぼくははると')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))

    await waitFor(() => {
      expect(openRenderFolder).toHaveBeenCalledWith(projectId, undefined)
    })
  })

  it('1 件ごとの「Finder で表示」は、その書き出しを選んで開く', async () => {
    const { openRenderFolder } = setup()

    fireEvent.click(await screen.findByRole('button', { name: 'Finder で表示' }))

    await waitFor(() => {
      expect(openRenderFolder).toHaveBeenCalledWith(projectId, JOB_ID)
    })
  })

  it('開けなければ理由を出す', async () => {
    setup({ openFails: true })

    fireEvent.click(await screen.findByRole('button', { name: 'フォルダを開く' }))

    expect(await screen.findByText(/Finder を開けませんでした/)).toBeTruthy()
  })

  it('Finder を開けない環境ではボタンを出さず、保存先だけ出す', async () => {
    setup({ canOpen: false })

    expect(await screen.findByText('保存先 ~/Movies/ixa-video-creator/ぼくははると')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'フォルダを開く' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Finder で表示' })).toBeNull()
  })
})

describe('これまでの書き出し', () => {
  it('「再生」でその場に動画を開き、もう一度押すと閉じる', async () => {
    const { resolveOutputUrl } = setup()
    const list = screen.getByRole('list', { name: 'これまでの書き出し' })

    fireEvent.click(within(list).getByRole('button', { name: '再生' }))
    await waitFor(() => {
      expect(list.querySelector('video')).not.toBeNull()
    })
    expect(resolveOutputUrl).toHaveBeenCalledWith(OUTPUT_ID)

    fireEvent.click(within(list).getByRole('button', { name: '閉じる' }))
    expect(list.querySelector('video')).toBeNull()
  })

  it('「最後の書き出し」の箱は出さない（一覧と同じことを言うため）', () => {
    setup()
    expect(screen.queryByText(/最後の書き出し/)).toBeNull()
  })
})
