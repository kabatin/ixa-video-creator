import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MakeMusicDialogBody } from '@/components/workbench/dialogs/make-music-dialog'
import { MusicJobsProvider } from '@/components/workbench/music-jobs'
import { ApiError } from '@/lib/api-error'
import type { MusicJobApi, WireMusicJob } from '@/lib/music-job-api'
import { PROJECT_ID } from './fixtures'
import { assetStoreValue, renderInWorkbench } from './workbench-fixture'

/**
 * 「曲を作る」（ADR-0048）。頼む本文・使えないときの知らせ・進み具合と止める・できたら楽曲を読み直す。
 */

const running: WireMusicJob = {
  id: 'job-1',
  status: 'running',
  prompt: 'j-pop',
  durationSec: 60,
  instrumental: false,
  count: 2,
  title: null,
  musicTrackIds: [],
  error: null,
  queuedAt: '2026-10-17T00:00:00.000Z',
  finishedAt: null,
}

const fakeApi = (patch: Partial<MusicJobApi> = {}): MusicJobApi => ({
  generateMusic: vi.fn().mockResolvedValue({ jobId: 'job-1' }),
  listMusicJobs: vi.fn().mockResolvedValue([]),
  cancelMusicJobs: vi.fn().mockResolvedValue({ cancelledJobIds: [] }),
  ...patch,
})

const renderDialog = (api: MusicJobApi, assets = assetStoreValue()) =>
  renderInWorkbench(
    <MusicJobsProvider api={api}>
      <MakeMusicDialogBody />
    </MusicJobsProvider>,
    {},
    assets,
  )

describe('曲を作る', () => {
  it('歌なしにすると歌詞の欄が使えなくなり、歌詞は送らない', async () => {
    const api = fakeApi()
    renderDialog(api)
    await userEvent.type(screen.getByLabelText('曲調'), 'lofi, piano')
    await userEvent.type(screen.getByLabelText('歌詞（なくてもよい）'), 'らら')
    await userEvent.click(screen.getByLabelText('歌なし（歌詞は使いません）'))
    expect(screen.getByLabelText('歌詞（なくてもよい）')).toBeDisabled()
    await userEvent.selectOptions(screen.getByLabelText('何曲'), '3')
    await userEvent.click(screen.getByRole('button', { name: '曲を作る' }))

    await waitFor(() => {
      expect(api.generateMusic).toHaveBeenCalledWith(PROJECT_ID, {
        prompt: 'lofi, piano',
        lyrics: '',
        durationSec: 60,
        instrumental: true,
        count: 3,
      })
    })
    expect(await screen.findByText('受け付けました。閉じても作り続けます。')).toBeInTheDocument()
  })

  it('欄が正しくなければ頼まず、欄ごとに理由を出す', async () => {
    const api = fakeApi()
    renderDialog(api)
    const duration = screen.getByLabelText('長さ（秒）')
    await userEvent.clear(duration)
    await userEvent.type(duration, '300')
    await userEvent.click(screen.getByRole('button', { name: '曲を作る' }))

    expect(await screen.findByText(/曲調を入れてください/)).toBeInTheDocument()
    expect(screen.getByText('長さは 10〜240 秒で入れてください')).toBeInTheDocument()
    expect(api.generateMusic).not.toHaveBeenCalled()
  })

  it('曲の AI が使えない（409）なら、サーバの理由をそのまま上の知らせに出す', async () => {
    const reason = '曲の AI がお試しのままです。メニュー「使う AI…」で選んでください'
    const api = fakeApi({
      generateMusic: vi.fn().mockRejectedValue(
        new ApiError('POST x', 409, JSON.stringify({ success: false, error: reason })),
      ),
    })
    const { value } = renderDialog(api)
    await userEvent.type(screen.getByLabelText('曲調'), 'rock')
    await userEvent.click(screen.getByRole('button', { name: '曲を作る' }))

    await waitFor(() => {
      expect(value.notify).toHaveBeenCalledWith(reason)
    })
    expect(screen.getByRole('alert')).toHaveTextContent(reason)
  })

  it('作っている間は進み具合と「止める」を出し、押すとまとめて止める', async () => {
    const api = fakeApi({ listMusicJobs: vi.fn().mockResolvedValue([running]) })
    renderDialog(api)
    expect(await screen.findByText('曲を作っています…（2 曲・1:00.00（60.00s））')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '止める' }))
    await waitFor(() => {
      expect(api.cancelMusicJobs).toHaveBeenCalledWith(PROJECT_ID)
    })
  })

  it('出来事が届いたら進み具合を取り直し、曲ができたら楽曲の一覧を読み直す', async () => {
    const api = fakeApi()
    const base = assetStoreValue()
    const assets = assetStoreValue({ actions: { ...base.actions, reloadTracks: vi.fn().mockResolvedValue(undefined) } })
    const { rerenderWith } = renderDialog(api, assets)
    await waitFor(() => {
      expect(api.listMusicJobs).toHaveBeenCalledTimes(1)
    })
    expect(assets.actions.reloadTracks).not.toHaveBeenCalled()

    rerenderWith({ musicJobEpoch: 1 })
    await waitFor(() => {
      expect(api.listMusicJobs).toHaveBeenCalledTimes(2)
    })
    expect(assets.actions.reloadTracks).not.toHaveBeenCalled()

    rerenderWith({ musicJobEpoch: 2, musicMadeEpoch: 1 })
    await waitFor(() => {
      expect(assets.actions.reloadTracks).toHaveBeenCalledTimes(1)
    })
  })
})
