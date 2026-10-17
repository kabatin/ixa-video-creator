import { ProjectId, ThumbnailId } from '@ixa/domain'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThumbnailPanel } from '@/components/thumbnail/thumbnail-panel'
import type { RenderFolderApi } from '@/lib/render-folder-api'
import { PlayheadSecContext } from '@/lib/playhead-sec'
import { WireThumbnail, type ThumbnailApi } from '@/lib/thumbnail-api'
import { MEDIA_ID, PROJECT_ID } from './fixtures'

/** サムネイルの書き出し画面（ADR-0051）。背景を選んで書き出し、終わったら名前とフォルダの口を出す。 */

// プレビューは `@remotion/player` を遅れて読む。ここでは書き出しの流れだけを見る。
vi.mock('@/components/thumbnail/thumbnail-preview', () => ({
  ThumbnailPreview: () => <div>プレビュー</div>,
}))

const projectId = ProjectId.parse(PROJECT_ID)
const THUMBNAIL_ID = ThumbnailId.parse('01ARZ3NDEKTSV4RRFFQ69G5FC1')

const doneThumbnail = WireThumbnail.parse({
  id: THUMBNAIL_ID,
  projectId: PROJECT_ID,
  spec: { background: { kind: 'timeline_frame', atSec: 12.5 }, title: 'iXA CUP' },
  status: 'done',
  outputAssetId: MEDIA_ID,
  fileName: 'iXA CUP サムネ 2026-10-17 10.00.00.jpg',
  error: null,
  createdAt: '2026-10-17T01:00:00.000Z',
  finishedAt: '2026-10-17T01:00:05.000Z',
})

const setup = () => {
  const api: ThumbnailApi = {
    startThumbnail: vi.fn<ThumbnailApi['startThumbnail']>(() => Promise.resolve(THUMBNAIL_ID)),
    getThumbnail: vi.fn<ThumbnailApi['getThumbnail']>(() => Promise.resolve(doneThumbnail)),
    listThumbnails: vi.fn<ThumbnailApi['listThumbnails']>(() => Promise.resolve([])),
    generateKeyArt: vi.fn<ThumbnailApi['generateKeyArt']>(() => Promise.resolve([])),
    listKeyArt: vi.fn<ThumbnailApi['listKeyArt']>(() => Promise.resolve([])),
  }
  const openRenderFolder = vi.fn<RenderFolderApi['openRenderFolder']>(() =>
    Promise.resolve({ location: '~/Movies/ixa', copied: 1, failed: [] }),
  )
  const folderApi: RenderFolderApi = {
    getRenderFolder: () => Promise.resolve({ location: '~/Movies/ixa', canOpen: true }),
    openRenderFolder,
  }
  render(
    <PlayheadSecContext.Provider value={12.5}>
      <ThumbnailPanel
        projectId={projectId}
        defaultTitle="iXA CUP"
        shots={[]}
        posters={new Map()}
        timeline={null}
        timelineError={null}
        api={api}
        folderApi={folderApi}
      />
    </PlayheadSecContext.Provider>,
  )
  return { api, openRenderFolder }
}

describe('ThumbnailPanel', () => {
  it('背景を選ばずに押すと、送らずに理由を出す', () => {
    const { api } = setup()
    fireEvent.click(screen.getByRole('button', { name: '書き出す' }))
    expect(screen.getByRole('alert')).toHaveTextContent('背景を選んでください')
    expect(api.startThumbnail).not.toHaveBeenCalled()
  })

  it('いまの位置のコマで書き出し、終わったら名前とフォルダの口を出す', async () => {
    const { api, openRenderFolder } = setup()
    expect(screen.getByText('いまの位置 0:12.50')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'このコマにする' }))
    fireEvent.click(screen.getByRole('button', { name: '書き出す' }))

    await waitFor(() => {
      expect(screen.getAllByText('iXA CUP サムネ 2026-10-17 10.00.00.jpg').length).toBeGreaterThan(0)
    })
    expect(api.startThumbnail).toHaveBeenCalledWith(
      projectId,
      expect.objectContaining({ background: { kind: 'timeline_frame', atSec: 12.5 }, title: 'iXA CUP' }),
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'フォルダで見る' })[0] as HTMLElement)
    await waitFor(() => {
      expect(openRenderFolder).toHaveBeenCalledWith(projectId, { thumbnailId: THUMBNAIL_ID })
    })
  })

  it('題名が長すぎれば domain の言葉で止める', () => {
    const { api } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'このコマにする' }))
    fireEvent.change(screen.getByLabelText(/^題名\d/), { target: { value: 'あ'.repeat(41) } })
    fireEvent.click(screen.getByRole('button', { name: '書き出す' }))
    expect(screen.getByText('題名は 40 字までにしてください')).toBeInTheDocument()
    expect(api.startThumbnail).not.toHaveBeenCalled()
  })
})
